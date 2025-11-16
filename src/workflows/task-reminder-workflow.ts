/**
 * Task Reminder Workflow
 * 
 * Handles complex reminder workflows including:
 * - Batch processing of multiple due tasks
 * - Multi-step reminder sequences (gentle → urgent → escalation)
 * - Retry logic for failed reminders
 * - Coordination of task checking and notification delivery
 */

import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers';
import type { Task } from '../utils';
import { generateId } from 'ai';

type Env = {
  Chat: DurableObjectNamespace;
  TASK_REMINDER_WORKFLOW: Workflow;
  BATCH_TASK_REMINDER_WORKFLOW: Workflow;
};

type TaskReminderParams = {
  taskId: string;
  taskName: string;
  frequency: string;
  reminderLevel: 'initial' | 'followup' | 'escalation';
  dueDate: string;
  daysOverdue?: number;
};

type BatchReminderParams = {
  dueTasks: Array<{
    id: string;
    name: string;
    frequency: string;
    daysOverdue: number;
  }>;
};

/**
 * Workflow for handling individual task reminders with escalation
 */
export class TaskReminderWorkflow extends WorkflowEntrypoint<Env, TaskReminderParams> {
  async run(event: WorkflowEvent<TaskReminderParams>, step: WorkflowStep) {
    const { taskId, taskName, frequency, reminderLevel, dueDate, daysOverdue } = event.payload;

    try {
      // Step 1: Send the reminder message
      await step.do('send-reminder', async () => {
        return await this.sendReminderMessage({
          taskId,
          taskName,
          frequency,
          reminderLevel,
          daysOverdue: daysOverdue || 0
        });
      });

      // Step 2: If this is an initial reminder, schedule a follow-up
      if (reminderLevel === 'initial') {
        await step.sleep('wait-for-followup', 24 * 60 * 60); // Wait 24 hours

        // Check if task is still due (not completed)
        const stillDue = await step.do('check-if-still-due', async () => {
          return await this.checkTaskStillDue(taskId);
        });

        if (stillDue) {
          // Send follow-up reminder
          await step.do('send-followup', async () => {
            return await this.sendReminderMessage({
              taskId,
              taskName,
              frequency,
              reminderLevel: 'followup',
              daysOverdue: (daysOverdue || 0) + 1
            });
          });

          // Step 3: If still not completed after follow-up, escalate
          await step.sleep('wait-for-escalation', 48 * 60 * 60); // Wait 48 more hours

          const stillDueAfterFollowup = await step.do('check-if-still-due-after-followup', async () => {
            return await this.checkTaskStillDue(taskId);
          });

          if (stillDueAfterFollowup) {
            await step.do('send-escalation', async () => {
              return await this.sendReminderMessage({
                taskId,
                taskName,
                frequency,
                reminderLevel: 'escalation',
                daysOverdue: (daysOverdue || 0) + 3
              });
            });
          }
        }
      }

      return {
        success: true,
        taskId,
        reminderLevel,
        completed: true
      };
    } catch (error) {
      // Return error - Cloudflare Workflows will automatically retry failed steps
      // The step.do() calls above will be retried automatically on failure
      return {
        success: false,
        taskId,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Send a reminder message to the chat agent
   */
  private async sendReminderMessage(params: {
    taskId: string;
    taskName: string;
    frequency: string;
    reminderLevel: 'initial' | 'followup' | 'escalation';
    daysOverdue: number;
  }): Promise<{ success: boolean; messageId: string }> {
    const { taskId, taskName, frequency, reminderLevel, daysOverdue } = params;

    // Determine reminder message based on level
    let reminderText = '';
    const emoji = reminderLevel === 'escalation' ? '🚨' : reminderLevel === 'followup' ? '⏰' : '🔔';
    
    if (reminderLevel === 'initial') {
      reminderText = `${emoji} Reminder: "${taskName}" is due. Frequency: ${frequency}.`;
    } else if (reminderLevel === 'followup') {
      reminderText = `${emoji} Follow-up: "${taskName}" is still due (${daysOverdue} day${daysOverdue !== 1 ? 's' : ''} overdue). Don't forget!`;
    } else {
      reminderText = `${emoji} URGENT: "${taskName}" is ${daysOverdue} day${daysOverdue !== 1 ? 's' : ''} overdue! Please complete this task soon.`;
    }

    const messageId = generateId();

    // Get the Chat agent instance and call its internal method to save the reminder
    const chatId = this.env.Chat.idFromName('chat');
    const chatAgent = this.env.Chat.get(chatId);

    // Use the agent's fetch method to trigger reminder saving
    // The agent will handle this via an internal endpoint
    const response = await chatAgent.fetch(new Request('http://agent/internal/add-reminder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messageId,
        text: reminderText,
        taskId,
        reminderLevel,
        metadata: {
          createdAt: new Date().toISOString(),
          taskId,
          reminderLevel
        }
      })
    }));

    if (!response.ok) {
      throw new Error(`Failed to send reminder: ${response.statusText}`);
    }

    return {
      success: true,
      messageId
    };
  }

  /**
   * Check if a task is still due (not completed)
   */
  private async checkTaskStillDue(taskId: string): Promise<boolean> {
    const chatId = this.env.Chat.idFromName('chat');
    const chatAgent = this.env.Chat.get(chatId);

    // Query agent to check task status via internal endpoint
    const response = await chatAgent.fetch(new Request(`http://agent/internal/check-task/${taskId}`, {
      method: 'GET'
    }));

    if (!response.ok) {
      return true; // Assume still due if we can't check
    }

    const data = await response.json<{ isDue: boolean }>();
    return data.isDue;
  }
}

/**
 * Workflow for batch processing multiple due tasks
 */
export class BatchTaskReminderWorkflow extends WorkflowEntrypoint<Env, BatchReminderParams> {
  async run(event: WorkflowEvent<BatchReminderParams>, step: WorkflowStep) {
    const { dueTasks } = event.payload;

    if (!dueTasks || dueTasks.length === 0) {
      return {
        success: true,
        processed: 0,
        message: 'No tasks to process'
      };
    }

    // Step 1: Process all tasks in parallel
    const results = await step.do('process-batch', async () => {
      const processingPromises = dueTasks.map(async (task) => {
        try {
          // Create individual reminder workflow for each task
          const workflowInstance = await this.env.TASK_REMINDER_WORKFLOW.create({
            id: `reminder-${task.id}-${Date.now()}`,
            params: {
              taskId: task.id,
              taskName: task.name,
              frequency: task.frequency,
              reminderLevel: 'initial',
              dueDate: new Date().toISOString(),
              daysOverdue: task.daysOverdue
            }
          });

          return {
            taskId: task.id,
            workflowId: workflowInstance.id,
            success: true
          };
        } catch (error) {
          return {
            taskId: task.id,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          };
        }
      });

      return await Promise.all(processingPromises);
    });

    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    // Step 2: If some failed, retry them
    if (failed > 0) {
      await step.sleep('retry-delay', 300); // Wait 5 minutes

      const failedTasks = dueTasks.filter((_, index) => !results[index].success);
      
      await step.do('retry-failed', async () => {
        const retryPromises = failedTasks.map(async (task) => {
          try {
            const workflowInstance = await this.env.TASK_REMINDER_WORKFLOW.create({
              id: `reminder-retry-${task.id}-${Date.now()}`,
              params: {
                taskId: task.id,
                taskName: task.name,
                frequency: task.frequency,
                reminderLevel: 'initial',
                dueDate: new Date().toISOString(),
                daysOverdue: task.daysOverdue
              }
            });

            return {
              taskId: task.id,
              workflowId: workflowInstance.id,
              success: true
            };
          } catch (error) {
            return {
              taskId: task.id,
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error'
            };
          }
        });

        return await Promise.all(retryPromises);
      });
    }

    return {
      success: true,
      processed: dueTasks.length,
      successful,
      failed,
      timestamp: new Date().toISOString()
    };
  }
}

