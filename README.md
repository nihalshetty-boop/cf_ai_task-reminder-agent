# Task Reminder Agent

A Cloudflare Workers-based AI chat agent for managing periodic tasks and reminders. Built with Cloudflare Agents, Workers AI, and React, this application provides an intelligent assistant that helps users create, track, and manage recurring tasks with flexible scheduling options.

## Live Demo

The application is deployed and available at: **[https://taskreminderagent.nihalshetty2001.workers.dev/](https://taskreminderagent.nihalshetty2001.workers.dev/)**

## Features

- **Interactive AI Chat Interface**: Natural language conversation with an AI assistant powered by Cloudflare Workers AI (Llama 3.3 70B)
- **Flexible Task Scheduling**: Create tasks with frequencies ranging from seconds to months (e.g., "every second", "30 minutes", "7 days", "2 weeks")
- **Automatic Task Checking**: Tasks are automatically checked every 30 minutes for due items
- **Intelligent Reminders**: Multi-level reminder system with escalation (initial → follow-up → urgent)
- **Task Management Tools**: Add, list, check due tasks, mark complete, delete individual tasks, or clear all tasks
- **Real-time Streaming**: Live streaming responses for immediate feedback
- **State Persistence**: Tasks and chat history persist across sessions using Durable Objects
- **Workflow Integration**: Uses Cloudflare Workflows for reliable batch processing and reminder delivery
- **Dark/Light Theme**: Toggle between dark and light themes
- **Modern UI**: Responsive React-based interface with markdown support

## Architecture

This project is built on Cloudflare's edge computing platform:

- **Cloudflare Workers**: Serverless runtime for the agent logic
- **Durable Objects**: Stateful storage for chat history and task data
- **Workers AI**: AI inference using Llama 3.3 70B model
- **Cloudflare Workflows**: Orchestration for batch task processing and reminder escalation
- **React**: Frontend UI framework
- **Vite**: Build tool and development server

## Prerequisites

- Node.js 18+ and npm
- Cloudflare account
- Cloudflare Workers AI access (enabled by default for Workers)

## Installation

1. Clone the repository:

```bash
git clone <repository-url>
cd cf_ai_task-reminder-agent
```

2. Install dependencies:

```bash
npm install
```

3. Generate TypeScript types for Cloudflare bindings:

```bash
npm run types
```

## Configuration

### Local Development

No environment variables are required for local development. The Workers AI binding is configured automatically through `wrangler.jsonc`.

### Production Deployment

Ensure your Cloudflare account has:
- Workers AI enabled
- Durable Objects enabled
- Workflows enabled

The configuration is managed through `wrangler.jsonc`:

- **AI Binding**: Configured to use Workers AI with remote inference
- **Durable Objects**: Chat agent state is stored in a Durable Object
- **Workflows**: Two workflows are configured for task reminder processing

## Running Locally

Start the development server:

```bash
npm start
```

This will:
- Start the Vite development server
- Run the Cloudflare Worker locally using Wrangler
- Open the application in your browser (typically at `http://localhost:8788`)

The local development environment includes:
- Hot module reloading for frontend changes
- Local Durable Objects storage
- Local Workers AI inference (if available) or remote inference
- Full debugging capabilities

## Deployment

Deploy to Cloudflare Workers:

```bash
npm run deploy
```

This command will:
1. Build the frontend assets and worker code
2. Deploy to Cloudflare Workers
3. Set up Durable Objects migrations
4. Configure Workflows

After deployment, you'll receive a URL where your agent is accessible.

## Project Structure

```
├── src/
│   ├── app.tsx                    # React chat UI component
│   ├── client.tsx                 # Client-side entry point
│   ├── server.ts                  # Chat agent implementation (Durable Object)
│   ├── tools.ts                   # AI tool definitions for task management
│   ├── utils.ts                   # Helper functions (task parsing, date calculations)
│   ├── workflows/
│   │   └── task-reminder-workflow.ts  # Cloudflare Workflows for reminders
│   ├── components/                # React UI components
│   │   ├── avatar/
│   │   ├── button/
│   │   ├── card/
│   │   ├── input/
│   │   ├── textarea/
│   │   └── ...
│   ├── hooks/                     # React hooks
│   ├── providers/                 # React context providers
│   └── styles.css                 # Global styles
├── public/                        # Static assets
├── tests/                         # Test files
├── wrangler.jsonc                 # Cloudflare Workers configuration
├── vite.config.ts                 # Vite build configuration
└── package.json                   # Dependencies and scripts
```

## Usage

### Starting a Conversation

Once the application is running, you can interact with the Task Reminder Agent through natural language. The agent understands various commands and questions about task management.

### Adding Tasks

Create recurring tasks with flexible frequencies:

- "Add a task to water plants every 7 days"
- "Remind me to review my budget every 2 weeks"
- "Create a task to drink water every hour"
- "Add blink to the list, frequency every second"

Supported frequency formats:
- Seconds: "1 second", "30 seconds"
- Minutes: "1 minute", "30 minutes"
- Hours: "1 hour", "2 hours"
- Days: "1 day", "7 days"
- Weeks: "1 week", "2 weeks"
- Months: "1 month", "3 months"

You can also use "every X [unit]" format (e.g., "every second", "every 2 days").

### Checking Due Tasks

Ask what tasks are currently due:

- "What tasks are due?"
- "What do I need to do?"
- "Show me what's overdue"

### Listing All Tasks

View all your tasks:

- "Show me all my tasks"
- "List all tasks"
- "What tasks do I have?"

### Marking Tasks Complete

When you complete a task, mark it as done:

- "Mark task [taskId] as complete"
- "I finished watering the plants" (the agent will help identify the task)

### Deleting Tasks

Remove tasks you no longer need:

- "Delete task [taskId]"
- "Remove the plant watering task"

### Clearing All Tasks

Start fresh by clearing all tasks:

- "Clear all tasks"
- "Delete all my tasks"
- "Remove everything"

## How It Works

### Task Scheduling

Tasks are stored in the agent's state (Durable Object) with:
- Unique ID
- Task name/description
- Frequency (parsed and validated)
- Creation timestamp
- Last completion timestamp (optional)

### Automatic Checking

A cron job runs every 30 minutes (`*/30 * * * *`) to check for due tasks. When tasks become due:
1. The system identifies all due tasks
2. Creates a batch reminder workflow
3. The workflow processes each task individually
4. Reminders are sent as messages in the chat

### Reminder Escalation

The reminder system uses a multi-level escalation:

1. **Initial Reminder**: Sent when a task first becomes due
2. **Follow-up Reminder**: Sent 24 hours later if the task is still not completed
3. **Escalation Reminder**: Sent 48 hours after follow-up if still not completed

Each reminder level uses different messaging to emphasize urgency.

### Task Due Calculation

A task is considered "due" when:
- The time since last completion (or creation if never completed) exceeds the task's frequency
- For example, a task with frequency "7 days" becomes due 7 days after creation or last completion

## Available Tools

The agent has access to the following tools (all execute automatically without confirmation):

1. **addTask**: Create a new periodic task
   - Parameters: `name` (string), `frequency` (string)
   - Returns: Success status and task details

2. **listTasks**: List all tasks
   - Parameters: None
   - Returns: Array of all tasks with their status

3. **checkDueTasks**: Check which tasks are currently due
   - Parameters: None
   - Returns: Array of due tasks with overdue information

4. **markTaskComplete**: Mark a task as completed
   - Parameters: `taskId` (string)
   - Returns: Success status and updated task

5. **deleteTask**: Remove a task
   - Parameters: `taskId` (string)
   - Returns: Success status and deleted task ID

6. **clearAllTasks**: Remove all tasks
   - Parameters: None
   - Returns: Count of cleared tasks

## Customization

### Changing the AI Model

The default model is `@cf/meta/llama-3.3-70b-instruct-fp8-fast`. To change it, edit `src/server.ts`:

```typescript
const model = workersai("@cf/your-model-name" as Parameters<typeof workersai>[0]);
```

Available models can be found in the Cloudflare Workers AI documentation.

### Modifying Task Check Frequency

Change the cron schedule in `src/server.ts`:

```typescript
this.schedule("*/30 * * * *", "checkAndRemindTasks", {});
```

Use standard cron syntax. For example:
- `*/15 * * * *` - Every 15 minutes
- `0 * * * *` - Every hour
- `0 */2 * * *` - Every 2 hours

### Customizing Reminder Messages

Edit the reminder text in `src/workflows/task-reminder-workflow.ts`:

```typescript
if (reminderLevel === 'initial') {
  reminderText = `Your custom message: "${taskName}" is due.`;
}
```

### UI Customization

- **Theme Colors**: Modify `src/styles.css` for color scheme changes
- **Components**: Edit components in `src/components/`
- **Layout**: Modify `src/app.tsx` for layout changes

## Development

### Available Scripts

- `npm start`: Start development server
- `npm run deploy`: Build and deploy to Cloudflare
- `npm test`: Run tests
- `npm run types`: Generate TypeScript types for Cloudflare bindings
- `npm run format`: Format code with Prettier
- `npm run check`: Run linting and type checking

### Testing

Run the test suite:

```bash
npm test
```

### Code Quality

The project uses:
- **Biome**: Linting and formatting
- **TypeScript**: Type checking
- **Prettier**: Code formatting

Run checks:

```bash
npm run check
```

## Troubleshooting

### AI Configuration Error

If you see an "AI Configuration Error" banner:
- Ensure your Cloudflare account has Workers AI enabled
- Check that the AI binding is correctly configured in `wrangler.jsonc`
- Verify your account has access to the selected model

### Tasks Not Being Reminded

- Check that the cron schedule is running (check logs)
- Verify tasks are being saved to state correctly
- Ensure the workflow bindings are configured in `wrangler.jsonc`
- Check that tasks have valid frequency formats

### State Not Persisting

- Verify Durable Objects migrations are applied
- Check that `wrangler.jsonc` has the correct Durable Object configuration
- Ensure you're using the same agent instance (same agent name)

### Build Errors

- Run `npm run types` to regenerate type definitions
- Clear `node_modules` and reinstall: `rm -rf node_modules && npm install`
- Check Node.js version (requires 18+)

## API Reference

### Internal Endpoints

The agent exposes internal endpoints for workflow communication:

- `POST /internal/add-reminder`: Add a reminder message to the chat
- `GET /internal/check-task/:taskId`: Check if a task is still due

These endpoints are used by workflows and should not be called directly.

### Agent State

The agent state structure:

```typescript
type AgentState = {
  tasks: Task[];
};

type Task = {
  id: string;
  name: string;
  frequency: string;
  createdAt: Date;
  lastCompleted?: Date;
};
```

## Learn More

- [Cloudflare Agents Documentation](https://developers.cloudflare.com/agents/)
- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)
- [Workers AI Documentation](https://developers.cloudflare.com/workers-ai/)
- [Cloudflare Workflows Documentation](https://developers.cloudflare.com/workflows/)
- [Durable Objects Documentation](https://developers.cloudflare.com/durable-objects/)

## License

MIT
