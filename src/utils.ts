// via https://github.com/vercel/ai/blob/main/examples/next-openai/app/api/use-chat-human-in-the-loop/utils.ts

import type {
  UIMessage,
  UIMessageStreamWriter,
  ToolSet,
  ToolCallOptions
} from "ai";
import { convertToModelMessages, isToolUIPart } from "ai";
import { APPROVAL } from "./shared";

function isValidToolName<K extends PropertyKey, T extends object>(
  key: K,
  obj: T
): key is K & keyof T {
  return key in obj;
}

/**
 * Processes tool invocations where human input is required, executing tools when authorized.
 */
export async function processToolCalls<Tools extends ToolSet>({
  dataStream,
  messages,
  executions
}: {
  tools: Tools; // used for type inference
  dataStream: UIMessageStreamWriter;
  messages: UIMessage[];
  executions: Record<
    string,
    // biome-ignore lint/suspicious/noExplicitAny: needs a better type
    (args: any, context: ToolCallOptions) => Promise<unknown>
  >;
}): Promise<UIMessage[]> {
  // Process all messages, not just the last one
  const processedMessages = await Promise.all(
    messages.map(async (message) => {
      const parts = message.parts;
      if (!parts) return message;

      const processedParts = await Promise.all(
        parts.map(async (part) => {
          // Only process tool UI parts
          if (!isToolUIPart(part)) return part;

          const toolName = part.type.replace(
            "tool-",
            ""
          ) as keyof typeof executions;

          // Only process tools that require confirmation (are in executions object) and are in 'input-available' state
          if (!(toolName in executions) || part.state !== "output-available")
            return part;

          let result: unknown;

          if (part.output === APPROVAL.YES) {
            // User approved the tool execution
            if (!isValidToolName(toolName, executions)) {
              return part;
            }

            const toolInstance = executions[toolName];
            if (toolInstance) {
              result = await toolInstance(part.input, {
                messages: convertToModelMessages(messages),
                toolCallId: part.toolCallId
              });
            } else {
              result = "Error: No execute function found on tool";
            }
          } else if (part.output === APPROVAL.NO) {
            result = "Error: User denied access to tool execution";
          } else {
            // If no approval input yet, leave the part as-is for user interaction
            return part;
          }

          // Forward updated tool result to the client.
          dataStream.write({
            type: "tool-output-available",
            toolCallId: part.toolCallId,
            output: result
          });

          // Return updated tool part with the actual result.
          return {
            ...part,
            output: result
          };
        })
      );

      return { ...message, parts: processedParts };
    })
  );

  return processedMessages;
}

/**
 * Clean up incomplete tool calls from messages before sending to API
 * Prevents API errors from interrupted or failed tool executions
 */
export function cleanupMessages(messages: UIMessage[]): UIMessage[] {
  return messages.filter((message) => {
    if (!message.parts) return true;

    // Filter out messages with incomplete tool calls
    const hasIncompleteToolCall = message.parts.some((part) => {
      if (!isToolUIPart(part)) return false;
      // Remove tool calls that are still streaming or awaiting input without results
      return (
        part.state === "input-streaming" ||
        (part.state === "input-available" && !part.output && !part.errorText)
      );
    });

    return !hasIncompleteToolCall;
  });
}

/**
 * Task frequency parsing and calculation utilities
 */

export type Task = {
  id: string;
  name: string;
  frequency: string; // e.g., "7 days", "2 weeks", "1 month", "30 days"
  lastCompleted?: Date;
  createdAt: Date;
};

/**
 * Parse frequency strings like "7 days", "2 weeks", "1 month", "30 minutes", "2 hours", "1 second" and convert to days
 * @param frequency - Frequency string in format "X second/seconds", "X minute/minutes", "X hour/hours", "X day/days", "X week/weeks", or "X month/months"
 * @returns Number of days (fractional for smaller units)
 * @throws Error if frequency format is invalid
 */
export function parseFrequencyToDays(frequency: string): number {
  // Handle "every X" format by removing "every"
  const normalizedFrequency = frequency.replace(/^every\s+/i, "").trim();
  
  const match = normalizedFrequency.match(
    /^(\d+)\s*(second|seconds|minute|minutes|hour|hours|day|days|week|weeks|month|months)$/i
  );
  if (!match) {
    throw new Error(
      `Invalid frequency format: ${frequency}. Use format like "1 second", "30 minutes", "2 hours", "7 days", or "2 weeks"`
    );
  }

  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();

  // Convert to days (fractional for smaller units)
  switch (unit) {
    case "second":
    case "seconds":
      return value / (24 * 60 * 60); // Convert seconds to fractional days
    case "minute":
    case "minutes":
      return value / (24 * 60); // Convert minutes to fractional days
    case "hour":
    case "hours":
      return value / 24; // Convert hours to fractional days
    case "day":
    case "days":
      return value;
    case "week":
    case "weeks":
      return value * 7;
    case "month":
    case "months":
      return value * 30; // Approximate
    default:
      throw new Error(`Unsupported frequency unit: ${unit}`);
  }
}

/**
 * Parse frequency strings and convert to milliseconds
 * @param frequency - Frequency string in format "X second/seconds", "X minute/minutes", "X hour/hours", "X day/days", "X week/weeks", or "X month/months"
 * @returns Number of milliseconds
 * @throws Error if frequency format is invalid
 */
export function parseFrequencyToMilliseconds(frequency: string): number {
  // Handle "every X" format by removing "every"
  const normalizedFrequency = frequency.replace(/^every\s+/i, "").trim();
  
  const match = normalizedFrequency.match(
    /^(\d+)\s*(second|seconds|minute|minutes|hour|hours|day|days|week|weeks|month|months)$/i
  );
  if (!match) {
    throw new Error(
      `Invalid frequency format: ${frequency}. Use format like "1 second", "30 minutes", "2 hours", "7 days", or "2 weeks"`
    );
  }

  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();

  // Convert directly to milliseconds for accuracy
  switch (unit) {
    case "second":
    case "seconds":
      return value * 1000; // seconds to milliseconds
    case "minute":
    case "minutes":
      return value * 60 * 1000; // minutes to milliseconds
    case "hour":
    case "hours":
      return value * 60 * 60 * 1000; // hours to milliseconds
    case "day":
    case "days":
      return value * 24 * 60 * 60 * 1000; // days to milliseconds
    case "week":
    case "weeks":
      return value * 7 * 24 * 60 * 60 * 1000; // weeks to milliseconds
    case "month":
    case "months":
      return value * 30 * 24 * 60 * 60 * 1000; // months to milliseconds (approximate)
    default:
      throw new Error(`Unsupported frequency unit: ${unit}`);
  }
}

/**
 * Check if a task is due based on its frequency and lastCompleted date
 * @param task - Task object with frequency, lastCompleted, and createdAt
 * @returns true if the task is due, false otherwise
 */
export function isTaskDue(task: {
  lastCompleted?: Date;
  frequency: string;
  createdAt: Date;
}): boolean {
  const frequencyMs = parseFrequencyToMilliseconds(task.frequency);
  const referenceDate = task.lastCompleted || task.createdAt;
  const timeSinceReference = Date.now() - referenceDate.getTime();
  return timeSinceReference >= frequencyMs;
}

/**
 * Calculate how many days overdue a task is (or 0 if not overdue)
 * @param task - Task object with frequency, lastCompleted, and createdAt
 * @returns Number of days overdue (negative if not yet due)
 */
export function getDaysOverdue(task: {
  lastCompleted?: Date;
  frequency: string;
  createdAt: Date;
}): number {
  const frequencyMs = parseFrequencyToMilliseconds(task.frequency);
  const referenceDate = task.lastCompleted || task.createdAt;
  const timeSinceReference = Date.now() - referenceDate.getTime();
  const daysOverdue = Math.floor(
    (timeSinceReference - frequencyMs) / (1000 * 60 * 60 * 24)
  );
  return daysOverdue;
}
