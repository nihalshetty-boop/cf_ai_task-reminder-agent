import { routeAgentRequest, type Schedule, type Connection } from "agents";

import { AIChatAgent } from "agents/ai-chat-agent";
import {
  generateId,
  streamText,
  type StreamTextOnFinishCallback,
  stepCountIs,
  createUIMessageStream,
  convertToModelMessages,
  createUIMessageStreamResponse,
  type ToolSet
} from "ai";
import { createWorkersAI } from "workers-ai-provider";
import {
  processToolCalls,
  cleanupMessages,
  type Task,
  isTaskDue,
  getDaysOverdue
} from "./utils";
import { tools, executions } from "./tools";

type AgentState = {
  tasks: Task[];
};

/**
 * Chat Agent implementation that handles real-time AI chat interactions
 */
export class Chat extends AIChatAgent<Env> {
  /**
   * Handle new connection - send welcome message if no messages exist
   */
  async onConnect(connection: Connection): Promise<void> {
    if (this.messages.length === 0) {
      const welcomeMessage = {
        id: generateId(),
        role: "assistant" as const,
        parts: [
          {
            type: "text" as const,
            text: `Hello! I'm your Task Reminder Assistant. I'm here to help you manage periodic tasks and reminders.

Here's what I can do for you:

• **Add recurring tasks** - Create reminders for tasks that need to be done regularly (e.g., "Remind me to water plants every 7 days" or "Add drink water every hour")

• **Check due tasks** - See what tasks are currently due or overdue

• **List all tasks** - View all your tasks and their frequencies

• **Mark tasks complete** - When you finish a task, I'll reset the timer

• **Delete tasks** - Remove tasks you no longer need

Tasks are automatically checked every 30 minutes, and I'll send you reminders when they become due. You can set frequencies from seconds to months - whatever works for you!

What would you like to do first?`
          }
        ],
        metadata: {
          createdAt: new Date()
        }
      };

      await this.saveMessages([welcomeMessage]);
    }
  }

  /**
   * Initialize state when agent is created
   * This ensures tasks array exists even if state is empty
   */
  async onStateUpdate(state: unknown, source: Connection | "server"): Promise<void> {
    const currentState = (this.state as AgentState) || {};
    const incomingState = (state as AgentState) || {};
    
    if (!currentState.tasks && !incomingState.tasks) {
      this.setState({
        ...currentState,
        ...incomingState,
        tasks: []
      } as AgentState);
    } else if (incomingState.tasks && incomingState.tasks.length > 0) {
      this.setState({
        ...currentState,
        ...incomingState
      } as AgentState);
    }

    if (source === "server") {
      const schedules = this.getSchedules();
      const alreadyScheduled = schedules.some(
        (s) => s.callback === "checkAndRemindTasks"
      );

      if (!alreadyScheduled) {
        this.schedule("*/30 * * * *", "checkAndRemindTasks", {}).catch(
          (error) => {
            console.error("Failed to schedule task checking:", error);
          }
        );
      }
    }

  }

  /**
   * Helper method to get tasks from state
   */
  async getTasks(): Promise<Task[]> {
    const state = (this.state as AgentState) || { tasks: [] };
    const tasks = state.tasks || [];
    return tasks.map((task) => ({
      ...task,
      createdAt: task.createdAt instanceof Date ? task.createdAt : new Date(task.createdAt),
      lastCompleted: task.lastCompleted 
        ? (task.lastCompleted instanceof Date ? task.lastCompleted : new Date(task.lastCompleted))
        : undefined
    }));
  }

  /**
   * Helper method to save tasks to state
   */
  async saveTasks(tasks: Task[]): Promise<void> {
    const currentState = (this.state as AgentState) || { tasks: [] };
    await this.setState({
      ...currentState,
      tasks
    } as AgentState);
  }

  /**
   * Check for due tasks and send reminder messages using Workflows
   * This method is called periodically by the scheduler
   */
  async checkAndRemindTasks(_data: Record<string, unknown>): Promise<void> {
    try {
      const tasks = await this.getTasks();
      const dueTasks = tasks.filter((task) => isTaskDue(task));

      if (dueTasks.length === 0) {
        return; // No tasks due, nothing to do
      }

      // Use Workflow for batch processing instead of direct messaging
      if (this.env.BATCH_TASK_REMINDER_WORKFLOW) {
        // Create batch reminder workflow instance
        const workflowInstance = await this.env.BATCH_TASK_REMINDER_WORKFLOW.create({
          id: `batch-reminder-${Date.now()}`,
          params: {
            dueTasks: dueTasks.map((task) => ({
              id: task.id,
              name: task.name,
              frequency: task.frequency,
              daysOverdue: getDaysOverdue(task)
            }))
          }
        });

        console.log(`Created batch reminder workflow: ${workflowInstance.id} for ${dueTasks.length} tasks`);
      } else {
        // Fallback to direct messaging if workflow not available
        const reminderMessages = dueTasks.map((task) => {
          const daysOverdue = getDaysOverdue(task);
          const overdueText =
            daysOverdue > 0
              ? ` (${daysOverdue} day${daysOverdue !== 1 ? "s" : ""} overdue)`
              : "";

          return {
            id: generateId(),
            role: "assistant" as const,
            parts: [
              {
                type: "text" as const,
                text: `🔔 Reminder: "${task.name}" is due${overdueText}. Frequency: ${task.frequency}.`
              }
            ],
            metadata: {
              createdAt: new Date()
            }
          };
        });

        await this.saveMessages([...this.messages, ...reminderMessages]);
      }
    } catch (error) {
      console.error("Error checking and reminding tasks:", error);
    }
  }

  /**
   * Handle internal requests from workflows
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Internal endpoint for workflows to add reminder messages
    if (url.pathname === "/internal/add-reminder" && request.method === "POST") {
      try {
        const body = await request.json<{
          messageId: string;
          text: string;
          taskId: string;
          reminderLevel: string;
          metadata: Record<string, unknown>;
        }>();

        const reminderMessage = {
          id: body.messageId,
          role: "assistant" as const,
          parts: [
            {
              type: "text" as const,
              text: body.text
            }
          ],
          metadata: {
            ...body.metadata,
            createdAt: new Date()
          }
        };

        await this.saveMessages([...this.messages, reminderMessage]);

        return Response.json({ success: true, messageId: body.messageId });
      } catch (error) {
        return Response.json(
          { success: false, error: error instanceof Error ? error.message : "Unknown error" },
          { status: 500 }
        );
      }
    }

    // Internal endpoint for workflows to check if task is still due
    if (url.pathname.startsWith("/internal/check-task/") && request.method === "GET") {
      try {
        const taskId = url.pathname.split("/internal/check-task/")[1];
        const tasks = await this.getTasks();
        const task = tasks.find((t) => t.id === taskId);

        if (!task) {
          return Response.json({ isDue: false, found: false });
        }

        const isDue = isTaskDue(task);
        return Response.json({ isDue, taskId, taskName: task.name });
      } catch (error) {
        return Response.json(
          { isDue: true, error: error instanceof Error ? error.message : "Unknown error" },
          { status: 500 }
        );
      }
    }

    // Fallback to parent fetch handler
    return super.fetch(request);
  }

  /**
   * Handles incoming chat messages and manages the response stream
   */
  async onChatMessage(
    onFinish: StreamTextOnFinishCallback<ToolSet>,
    _options?: { abortSignal?: AbortSignal }
  ) {
    // Don't process if there are no messages or the last message is from assistant (not a user message)
    // This prevents the AI from responding to its own welcome message
    const cleanedMessages = cleanupMessages(this.messages);
    const lastMessage = cleanedMessages[cleanedMessages.length - 1];
    if (!lastMessage || lastMessage.role !== "user") {
      // No user message to respond to, return empty stream
      return createUIMessageStreamResponse({
        stream: createUIMessageStream({
          execute: async () => {
            // Do nothing - no response needed
          }
        })
      });
    }

    // const mcpConnection = await this.mcp.connect(
    //   "https://path-to-mcp-server/sse"
    // );

    // Collect all tools, including MCP tools
    const allTools = {
      ...tools,
      ...this.mcp.getAITools()
    };

    // Create Workers AI model instance with environment binding
    const workersai = createWorkersAI({ binding: this.env.AI });
    // Type assertion needed as model name may be valid at runtime but not yet in type definitions
    const model = workersai(
      "@cf/meta/llama-3.3-70b-instruct-fp8-fast" as Parameters<typeof workersai>[0]
    );

    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        // Clean up incomplete tool calls to prevent API errors
        const cleanedMessages = cleanupMessages(this.messages);

        // Process any pending tool calls from previous messages
        // This handles human-in-the-loop confirmations for tools
        const processedMessages = await processToolCalls({
          messages: cleanedMessages,
          dataStream: writer,
          tools: allTools,
          executions
        });

        const result = streamText({
          system: `You are a helpful task reminder assistant that helps users manage periodic tasks and reminders.

ABSOLUTELY CRITICAL - RESPONSE FORMAT RULES

YOU MUST ALWAYS RESPOND IN PLAIN TEXT. NEVER EVER RETURN JSON, CODE BLOCKS, OR RAW DATA.

DO NOT OUTPUT TOOL CALL INFORMATION. When you call a tool, DO NOT show the tool call JSON like {"name": "checkDueTasks", "parameters": {}}. Only show your natural language response.

Examples of CORRECT responses:
 "I've added the task 'Water plants' with frequency every 7 days. I'll remind you when it's due!"
 "You have 2 tasks due: 'Water plants' (due today) and 'Review budget' (1 day overdue)"
 "Here are all your tasks: 1. Water plants (every 7 days) 2. Review budget (every 14 days)"

Examples of INCORRECT responses (NEVER DO THIS):
 {"success": true, "task": {"name": "Water plants"}}
 \`\`\`json\n{"tasks": [...]}\n\`\`\`
 {"type": "function", "name": "addTask", "parameters": {...}}
 {"name": "checkDueTasks", "parameters": {}}
 Any JSON object showing tool calls or function names

CRITICAL RULES:
1. You MUST ALWAYS respond in natural, conversational language. NEVER return raw JSON, code blocks, or tool results directly to the user.
2. After EVERY tool execution, you MUST generate a text response explaining what happened in plain language - write complete sentences, not JSON.
3. When you call a tool, you MUST follow up with a natural language message to the user - do not stop after just calling the tool.
4. Always interpret tool results and present them in a friendly, readable format using plain text only.
5. Never show JSON objects, code blocks, function call structures, or any structured data format to the user - ONLY show natural language responses.
6. If you see tool results like {"success": true, "tasks": [...]}, convert them to sentences like "I found 3 tasks: Task 1, Task 2, Task 3"
7. Your response should be readable text that a human would naturally say - no JSON, no code blocks, no structured data.

## Task Reminder Functionality

You can help users create, manage, and track periodic tasks that need to be completed at regular intervals. Tasks are automatically checked every 30 minutes, and reminders are sent when tasks become due.

## Available Task Management Tools

1. **addTask** - Add a new periodic task
   - Use when: User wants to create a recurring task (e.g., "remind me to water plants every week")
   - Parameters:
     - name: The task description (e.g., "Water plants", "Review budget", "Drink water")
     - frequency: How often the task repeats (format: "X second/seconds", "X minute/minutes", "X hour/hours", "X day/days", "X week/weeks", "X month/months", or "every X [unit]")
   - Examples:
     - "Add blink to the list, frequency every second" or "Add blink, frequency 1 second"
     - "Add a task to drink water every minute" or "Add drink water, frequency 1 minute"
     - "Add a task to water plants every 7 days"
     - "Remind me to review my budget every 2 weeks"
     - "Create a monthly task for paying bills"
     - "Add check email every hour"

2. **listTasks** - List all tasks
   - Use when: User asks to see their tasks, view all reminders, or check what tasks they have
   - Parameters: None
   - Example: "Show me all my tasks" or "What tasks do I have?"

3. **checkDueTasks** - Check which tasks are currently due
   - Use when: User asks what's due, what needs to be done, or what tasks are overdue
   - Parameters: None
   - Example: "What tasks are due?" or "What do I need to do?"

4. **markTaskComplete** - Mark a task as completed
   - Use when: User completes a task and wants to mark it done
   - Parameters:
     - taskId: The ID of the task (get this from listTasks or checkDueTasks)
   - Example: "Mark task [taskId] as complete" or "I finished watering the plants"

5. **deleteTask** - Remove a task
   - Use when: User wants to remove a task they no longer need
   - Parameters:
     - taskId: The ID of the task to delete
   - Example: "Delete task [taskId]" or "Remove the plant watering task"

6. **clearAllTasks** - Remove all tasks from the list
   - Use when: User wants to clear all tasks at once or start fresh
   - Parameters: None
   - Example: "Clear all tasks" or "Delete all my tasks" or "Remove everything"

## Frequency Format Examples

When adding tasks, use these frequency formats:
- "1 second" or "1 seconds" - Every second
- "1 minute" or "1 minutes" - Every minute
- "30 minutes" - Every 30 minutes
- "1 hour" or "1 hours" - Hourly
- "2 hours" - Every 2 hours
- "1 day" or "1 days" - Daily
- "7 days" - Weekly
- "14 days" or "2 weeks" - Bi-weekly
- "30 days" or "1 month" - Monthly
- "90 days" or "3 months" - Quarterly

You can also use "every X [unit]" format (e.g., "every second", "every minute", "every hour", "every 2 days")

## How Task Reminders Work

- Tasks are checked automatically every 30 minutes
- A task is "due" when the time since last completion (or creation) exceeds its frequency
- Reminders appear as messages in the chat when tasks become due
- When a user marks a task complete, the timer resets from that date

## Usage Guidelines

- Always use addTask when users want to create recurring reminders
- When users ask "what do I need to do?", use checkDueTasks
- When users complete something, help them mark it complete using markTaskComplete
- Be proactive: if a user mentions completing a task, offer to mark it complete
- If listing tasks, show the task ID so users can reference it for completion/deletion
- If users want to clear all tasks, use clearAllTasks tool

## Important: Always Respond After Tool Execution

After executing a tool, ALWAYS provide a natural language response to the user. DO NOT return JSON or raw data. Write complete sentences in plain text.

- For checkDueTasks: Say something like "You have X tasks due:" then list them in a friendly format with their details. Example: "You have 2 tasks due: 'Water plants' is due today, and 'Review budget' is 1 day overdue."
- For listTasks: Say "Here are all your tasks:" then present them in a readable list format with task names, frequencies, and status. Example: "Here are all your tasks: 1. Water plants (every 7 days, not due yet) 2. Review budget (every 14 days, due tomorrow)"
- For addTask: Say "I've added the task '[name]' with frequency [frequency]" Example: "I've added the task 'Water plants' with frequency every 7 days. I'll remind you when it's due!"
- For markTaskComplete: Say "Great! I've marked '[task name]' as complete. It will be due again in [frequency]" Example: "Great! I've marked 'Water plants' as complete. It will be due again in 7 days."
- For deleteTask: Say "I've removed the task '[task name]'" Example: "I've removed the task 'Water plants'."
- For clearAllTasks: Say "I've cleared all X tasks" Example: "I've cleared all 3 tasks from your list."

 REMEMBER: When you see tool results like {"success": true, "tasks": [...]}, you MUST convert them to plain text sentences. NEVER show the JSON to the user. ALWAYS write natural language responses.
`,

          messages: convertToModelMessages(processedMessages),
          model,
          tools: allTools,
          // Type boundary: streamText expects specific tool types, but base class uses ToolSet
          // This is safe because our tools satisfy ToolSet interface (verified by 'satisfies' in tools.ts)
          onFinish: onFinish as unknown as StreamTextOnFinishCallback<
            typeof allTools
          >,
          // Increase step count to allow model to respond after tool calls
          // The model needs multiple steps: 1) understand request, 2) call tool, 3) process result, 4) generate response
          stopWhen: stepCountIs(20)
        });

        writer.merge(result.toUIMessageStream());
      }
    });

    return createUIMessageStreamResponse({ stream });
  }
  async executeTask(description: string, _task: Schedule<string>) {
    await this.saveMessages([
      ...this.messages,
      {
        id: generateId(),
        role: "user",
        parts: [
          {
            type: "text",
            text: `Running scheduled task: ${description}`
          }
        ],
        metadata: {
          createdAt: new Date()
        }
      }
    ]);
  }
}

/**
 * Worker entry point that routes incoming requests to the appropriate handler
 */
export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (url.pathname === "/check-ai-config") {
      return Response.json({
        success: true,
        provider: "Workers AI",
        model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast"
      });
    }

    return (
      // Route the request to our agent or return 404 if not found
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  }
} satisfies ExportedHandler<Env>;
