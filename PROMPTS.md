Prompts for used for the project: I have used Cursor and ChatGPT 5.1 for debugging, planning the architecture and learning about Cloudflare's Agents Platform.

- I have an idea for the app- There are tons of things I do periodically (wash my car, vacuum, do laundry, clean bathroom, cut my hair, replace toothbrush etc.) and I don't want to think about what is the last time I did a particular task. This agent can periodically remind me of any particular task from the list which is due based on it's mentioned frequency. Is this a good idea for the requirements of the assignment? Can the cloudflare agent do this task? What components will it make use of? 

- See instructions below for Cloudflare AI app assignment. 
Build a type of AI-powered application on Cloudflare. An AI-powered application should include the following components:
LLM (recommend using Llama 3.3 on Workers AI), or an external LLM of your choice
Workflow / coordination (recommend using Workflows, Workers or Durable Objects)
User input via chat or voice (recommend using Pages or Realtime)
Memory or state

For this project, I have the following idea: There are tons of things I do periodically (wash my car, vacuum, do laundry, clean bathroom, cut my hair, replace toothbrush etc.) and I don't want to think about what is the last time I did a particular task. This agent can periodically remind me of any particular task from the list which is due based on it's mentioned frequency.

Help me build this but I will be making the code changes. You will only tell me what to do. DO NOT MAKE FILE CHANGES YOURSELF.

I want to use llama 3.3 instead of an openai model.

- Can you go through my project and check for formatting, any issues, and mismatches?

- Why is the agent return JSON at the end of the messages?

- Add a welcome message from the agent, introducing itself and giving an overview of what it can do for me. This message should be sent when the chat is opened for the first time, before the user says anything

- llama-3.3-70b-instruct-fp8-fast
Use this model

