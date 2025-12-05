# File Upload Reference for GoCaaS OI Integration

This document provides reference information for adding file upload capabilities to chat in the context of GoCaaS OI (Open-WebUI Extensions) integration.

## Overview

File upload functionality allows users to attach files during conversations with AI agents. The GoCaaS OI platform handles file processing, chunking, and indexing, then makes relevant context available to AI agents through the system prompt or file metadata.

## Enabling File Uploads

File upload capability is **disabled by default** for AI agents. To enable it, add the following to your agent descriptor:

```yaml
capabilities:
  file_upload: true
```

## Field Mappings for File Metadata

When users upload files during a chat, your agent can receive lightweight metadata for those files. Map the platform-provided file metadata to your agent's expected request field using `field_mappings.chat_files_metadata`.

### Example Mapping

```yaml
field_mappings:
  chat_files_metadata: "files"  # agent expects files metadata in 'files'
```

### Example Request Payload

When files are uploaded, the platform will include an array of objects with `{id, name}` for files uploaded by the user in the current conversation:

```json
{
  "files": [
    { "id": "abc123_myfile.pdf", "name": "myfile.pdf" },
    { "id": "xyz789_notes.txt", "name": "notes.txt" }
  ]
}
```

### Important Notes

- The `id` is an opaque identifier created by the platform; treat it as a token and do not try to reconstruct it. Use it verbatim in any follow-up actions.
- Only files of type `file` (not KBs) that have completed upload are included.
- File metadata is only included when you map the `chat_files_metadata` field.

## Files in System Prompt

When files or Knowledge Bases are referenced during a conversation, the GoCaaS OI platform automatically:

1. Extracts relevant contextual data from uploaded files
2. Chunks and indexes the content
3. Makes it available in the `system_prompt` message
4. Ensures your agent always sees an up-to-date system prompt

### System Prompt Structure

The system prompt includes file contents in a structured format with source tags:

```
### Task:
Respond to the user query using the provided context, incorporating inline citations in the format [id] **only when the <source> tag includes an explicit id attribute** (e.g., <source id="1">).

### Guidelines:
- If you don't know the answer, clearly state that.
- If uncertain, ask the user for clarification.
- Respond in the same language as the user's query.
- If the context is unreadable or of poor quality, inform the user and provide the best possible answer.
- If the answer isn't present in the context but you possess the knowledge, explain this to the user and provide the answer using your own understanding.

### Output:
Provide a clear and direct response to the user's query, including inline citations in the format [id] only when the <source> tag with id attribute is present in the context.

<context>
<source id="1">....file contents....</source>
<source id="2">....file content.....</source>
</context>
```

### When to Use system_prompt vs messages

- **Use `system_prompt`** when your agent needs the consolidated system prompt (which includes file/KB context) along with the current `user_message`, but does not need the rest of the chat history.
- **Use `messages`** when your agent needs the entire conversation history: the single system prompt, prior user prompts and assistant responses, and the current user prompt.

## Requesting File Uploads to Your Service

If your agent needs the actual file contents (not just metadata), it can request uploads by returning a list of file IDs in the response. The platform will then upload those files to your configured endpoint.

### Descriptor Requirements

1. **Provide environment-specific file upload endpoints:**

```yaml
file_upload_endpoints:
  dev-private: "https://api.example.com/v2/chat-bot/file-upload"
  dev: "https://api.example.com/v2/chat-bot/file-upload"
  test: "https://api.example.com/v2/chat-bot/file-upload"
  prod: "https://api.example.com/v2/chat-bot/file-upload"
```

2. **Map the field your agent uses to request uploads:**

```yaml
field_mappings:
  chat_files_metadata: "files"      # request: files metadata
  file_upload_ids: "file_upload_ids" # response: ids to upload
  output: "response"
```

### Example Agent Response Requesting Uploads

```json
{
  "file_upload_ids": ["abc123_myfile.pdf", "xyz789_notes.txt"],
  "response": "I will analyze the uploaded files and get back to you."
}
```

### Platform Behavior

- The platform validates that each requested `file_upload_id` exists in the `chat_files_metadata` sent to your agent.
- Only validated IDs are uploaded to your `file_upload_endpoint` for the current environment.
- Authentication headers managed by the platform are included as configured elsewhere.
- If an ID is not recognized, it is skipped and a warning is logged.

## Complete Example: Agent Descriptor with File Upload

```yaml
name: "File Processing Agent"
title: "Document Analysis Agent"
description: "Analyzes uploaded documents and provides insights"

endpoint:
  dev: "https://api.int.dev-godaddy.com/document-analyzer"
  test: "https://api.int.test-godaddy.com/document-analyzer"
  prod: "https://api.int.godaddy.com/document-analyzer"

file_upload_endpoints:
  dev: "https://api.int.dev-godaddy.com/document-analyzer/file-upload"
  test: "https://api.int.test-godaddy.com/document-analyzer/file-upload"
  prod: "https://api.int.godaddy.com/document-analyzer/file-upload"

capabilities:
  file_upload: true

field_mappings:
  user_message: "prompt"
  chat_id: "conversationId"
  message_id: "messageId"
  system_prompt: "systemPrompt"
  chat_files_metadata: "files"
  file_upload_ids: "file_upload_ids"
  output: "response"

deploy_envs: "dev,test,prod"

suggestion_prompts:
  - "Analyze the uploaded document"
  - "What are the key points in the attached file?"
```

## Standard Field Mappings Reference

### Supported Fields (LHS - Left Hand Side)

These are the standard field names defined by GoCaaS OI. You should not change these names.

- **`user_message`**: The user's message (string)
- **`chat_id`**: The chat or conversation ID (string)
- **`message_id`**: The message ID (string)
- **`messages`**: Ordered list of chat messages with schema `{role, content}` covering the single system prompt, all prior user + assistant messages, and the current user prompt
- **`system_prompt`**: The single consolidated system prompt for the conversation. This includes the base instructions plus appended context about any files/KBs referenced or uploaded by the user across the conversation
- **`chat_files_metadata`**: Array of metadata for user-uploaded files in the current chat. Each item has `{id, name}`. Included only when you map this field
- **`output`**: The field in the agent's response containing the main output (string or object, **required**)
- **`citations`**: The field in the agent's response containing citation data in OpenWebUI format (array or object, optional)
- **`file_upload_ids`**: The field in the agent's response containing file IDs to upload to your service (array of strings, optional)

### How Field Mappings Work

- **Left-hand side (LHS)**: Standard field names owned by GoCaaS OI (don't change these)
- **Right-hand side (RHS)**: Field names as expected by your AI agent's REST API schema (you provide these)

When a user interacts with your agent, the platform uses the field mappings to translate its internal field names to those expected by your agent. You do not need to change your agent's API schema—the platform adapts to your agent.

## Integration with Browser Extension

When implementing file upload in the browser extension:

1. **File Selection**: Users can select files through the "+" menu
2. **File Display**: Selected files are shown as chips above the input field
3. **File Metadata**: File metadata (id, name) should be included in the message payload when sending to GoCaaS OI
4. **File Upload**: The platform handles actual file uploads to storage
5. **Context Inclusion**: File contents are automatically included in the system prompt when relevant

### Example: Including File Metadata in Request

When sending a message with files, include the file metadata in the request:

```typescript
const message = {
  user_message: "Analyze these files",
  chat_id: "chat-123",
  files: [
    { id: "file-abc-123", name: "document.pdf" },
    { id: "file-xyz-789", name: "spreadsheet.xlsx" }
  ]
};
```

## Best Practices

1. **Enable file uploads explicitly**: Always set `capabilities.file_upload: true` if your agent needs files
2. **Use file metadata**: Use `chat_files_metadata` to receive file information without handling uploads yourself
3. **Request uploads when needed**: Use `file_upload_ids` in your response only when you need the actual file contents
4. **Handle file IDs correctly**: Treat file IDs as opaque tokens—don't try to parse or reconstruct them
5. **Validate file IDs**: When requesting uploads, ensure the IDs exist in the metadata you received
6. **System prompt vs metadata**: Use `system_prompt` for file content context, use `chat_files_metadata` for file information

## References

- GoCaaS OI Agent Descriptor Documentation
- Open-WebUI Extensions Repository
- Field Mappings Guide
- Citation Support Documentation

