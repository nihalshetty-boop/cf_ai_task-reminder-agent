/**
 * Tool definitions for the AI chat agent
 * Tools can either require human confirmation or execute automatically
 */
import { tool, type ToolSet } from "ai";
import { z } from "zod/v3";

import type { Chat } from "./server";
import { getCurrentAgent } from "agents";
import { generateId } from "ai";
import {
  type Task,
  parseFrequencyToDays,
  isTaskDue,
  getDaysOverdue
} from "./utils";

type AgentState = {
  tasks: Task[];
};

// 1. addTask tool
export const addTask = tool({
  description:
    "Add a new periodic task that needs to be completed at regular intervals",
  inputSchema: z.object({
    name: z.string().describe("The name or description of the task"),
    frequency: z
      .string()
      .describe(
        "How often the task should be completed (e.g., '1 second', '1 minute', '30 minutes', '2 hours', '7 days', '2 weeks', '1 month', or 'every X [unit]')"
      )
  }),
  execute: async ({ name, frequency }: { name: string; frequency: string }) => {
    const context = getCurrentAgent<Chat>();
    const agent = context.agent;

    if (!agent) {
      throw new Error("Agent not available");
    }

    // Validate frequency format
    parseFrequencyToDays(frequency); // Will throw if invalid

    const newTask: Task = {
      id: generateId(),
      name,
      frequency,
      createdAt: new Date(),
      lastCompleted: undefined
    };

    // Get current tasks from state - read fresh state each time
    const currentState = (agent.state as AgentState) || { tasks: [] };
    // Deserialize dates from strings (state persistence converts Dates to strings)
    const tasks: Task[] = (currentState.tasks || []).map((task) => ({
      ...task,
      createdAt: task.createdAt instanceof Date ? task.createdAt : new Date(task.createdAt),
      lastCompleted: task.lastCompleted 
        ? (task.lastCompleted instanceof Date ? task.lastCompleted : new Date(task.lastCompleted))
        : undefined
    }));

    // Add new task
    const updatedTasks = [...tasks, newTask];

    // Save to state - preserve all existing state properties
    await agent.setState({
      ...currentState,
      tasks: updatedTasks
    } as AgentState);

    return {
      success: true,
      task: newTask,
      message: `Task "${name}" added with frequency ${frequency}`
    };
  }
});

// 2. markTaskComplete tool
export const markTaskComplete = tool({
  description: "Mark a task as completed, updating its lastCompleted date",
  inputSchema: z.object({
    taskId: z
      .string()
      .describe("The unique identifier of the task to mark as complete")
  }),
  execute: async ({ taskId }: { taskId: string }) => {
    const context = getCurrentAgent<Chat>();
    const agent = context.agent;

    if (!agent) {
      throw new Error("Agent not available");
    }

    const currentState = (agent.state as AgentState) || { tasks: [] };
    // Deserialize dates from strings (state persistence converts Dates to strings)
    const tasks: Task[] = (currentState.tasks || []).map((task) => ({
      ...task,
      createdAt: task.createdAt instanceof Date ? task.createdAt : new Date(task.createdAt),
      lastCompleted: task.lastCompleted 
        ? (task.lastCompleted instanceof Date ? task.lastCompleted : new Date(task.lastCompleted))
        : undefined
    }));

    const taskIndex = tasks.findIndex((t) => t.id === taskId);
    if (taskIndex === -1) {
      return {
        success: false,
        message: `Task with ID ${taskId} not found`
      };
    }

    // Update task
    const updatedTasks = [...tasks];
    updatedTasks[taskIndex] = {
      ...updatedTasks[taskIndex],
      lastCompleted: new Date()
    };

    // Save to state
    await agent.setState({
      ...currentState,
      tasks: updatedTasks
    } as AgentState);

    return {
      success: true,
      task: updatedTasks[taskIndex],
      message: `Task "${updatedTasks[taskIndex].name}" marked as completed`
    };
  }
});

// 3. listTasks tool
export const listTasks = tool({
  description: "List all tasks that have been created",
  inputSchema: z.object({}),
  execute: async () => {
    try {
      const context = getCurrentAgent<Chat>();
      const agent = context.agent;

      if (!agent) {
        return {
          success: false,
          error: "Agent not available",
          tasks: [],
          count: 0
        };
      }

      const currentState = (agent.state as AgentState) || { tasks: [] };
      // Deserialize dates from strings (state persistence converts Dates to strings)
      const tasks: Task[] = (currentState.tasks || []).map((task) => ({
        ...task,
        createdAt: task.createdAt instanceof Date ? task.createdAt : new Date(task.createdAt),
        lastCompleted: task.lastCompleted 
          ? (task.lastCompleted instanceof Date ? task.lastCompleted : new Date(task.lastCompleted))
          : undefined
      }));

      return {
        success: true,
        tasks: tasks.map((task) => ({
          id: task.id,
          name: task.name,
          frequency: task.frequency,
          lastCompleted: task.lastCompleted?.toISOString(),
          createdAt: task.createdAt.toISOString(),
          isDue: isTaskDue(task)
        })),
        count: tasks.length
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error occurred",
        tasks: [],
        count: 0
      };
    }
  }
});

// 4. checkDueTasks tool
export const checkDueTasks = tool({
  description:
    "Check which tasks are currently due based on their frequency and lastCompleted date",
  inputSchema: z.object({}),
  execute: async () => {
    try {
      const context = getCurrentAgent<Chat>();
      const agent = context.agent;

      if (!agent) {
        return {
          success: false,
          error: "Agent not available",
          dueTasks: [],
          count: 0
        };
      }

      const currentState = (agent.state as AgentState) || { tasks: [] };
      // Deserialize dates from strings (state persistence converts Dates to strings)
      const tasks: Task[] = (currentState.tasks || []).map((task) => ({
        ...task,
        createdAt: task.createdAt instanceof Date ? task.createdAt : new Date(task.createdAt),
        lastCompleted: task.lastCompleted 
          ? (task.lastCompleted instanceof Date ? task.lastCompleted : new Date(task.lastCompleted))
          : undefined
      }));

      const dueTasks = tasks.filter((task) => isTaskDue(task));

      return {
        success: true,
        dueTasks: dueTasks.map((task) => ({
          id: task.id,
          name: task.name,
          frequency: task.frequency,
          lastCompleted: task.lastCompleted?.toISOString(),
          createdAt: task.createdAt.toISOString(),
          daysOverdue: getDaysOverdue(task)
        })),
        count: dueTasks.length
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error occurred",
        dueTasks: [],
        count: 0
      };
    }
  }
});

// 5. deleteTask tool
export const deleteTask = tool({
  description: "Remove a task from the task list",
  inputSchema: z.object({
    taskId: z.string().describe("The unique identifier of the task to delete")
  }),
  execute: async ({ taskId }: { taskId: string }) => {
    const context = getCurrentAgent<Chat>();
    const agent = context.agent;

    if (!agent) {
      throw new Error("Agent not available");
    }

    const currentState = (agent.state as AgentState) || { tasks: [] };
    // Deserialize dates from strings (state persistence converts Dates to strings)
    const tasks: Task[] = (currentState.tasks || []).map((task) => ({
      ...task,
      createdAt: task.createdAt instanceof Date ? task.createdAt : new Date(task.createdAt),
      lastCompleted: task.lastCompleted 
        ? (task.lastCompleted instanceof Date ? task.lastCompleted : new Date(task.lastCompleted))
        : undefined
    }));

    const taskIndex = tasks.findIndex((t) => t.id === taskId);
    if (taskIndex === -1) {
      return {
        success: false,
        message: `Task with ID ${taskId} not found`
      };
    }

    const deletedTask = tasks[taskIndex];

    // Remove task
    const updatedTasks = tasks.filter((t) => t.id !== taskId);

    // Save to state
    await agent.setState({
      ...currentState,
      tasks: updatedTasks
    } as AgentState);

    return {
      success: true,
      message: `Task "${deletedTask.name}" has been deleted`,
      deletedTaskId: taskId
    };
  }
});

// 6. clearAllTasks tool
export const clearAllTasks = tool({
  description: "Remove all tasks from the task list",
  inputSchema: z.object({}),
  execute: async () => {
    const context = getCurrentAgent<Chat>();
    const agent = context.agent;

    if (!agent) {
      throw new Error("Agent not available");
    }

    const currentState = (agent.state as AgentState) || { tasks: [] };
    const taskCount = currentState.tasks?.length || 0;

    // Clear all tasks
    await agent.setState({
      ...currentState,
      tasks: []
    } as AgentState);

    return {
      success: true,
      message: `All ${taskCount} task${taskCount !== 1 ? "s" : ""} have been cleared`,
      clearedCount: taskCount
    };
  }
});

// Export all tools together
export const tools = {
  addTask,
  markTaskComplete,
  listTasks,
  checkDueTasks,
  deleteTask,
  clearAllTasks
} satisfies ToolSet;

// No executions needed since all tools have execute functions
export const executions = {};
