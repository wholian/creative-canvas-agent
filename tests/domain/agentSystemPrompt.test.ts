import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAT_AGENT_SYSTEM_PROMPT } from '../../server/agent/prompts/system.js';

test('agent system prompt routes creation to tools instead of forced JSON or clarification', () => {
  assert.match(CHAT_AGENT_SYSTEM_PROMPT, /acting on the canvas/i);
  assert.match(CHAT_AGENT_SYSTEM_PROMPT, /create one image draft/i);
  assert.match(CHAT_AGENT_SYSTEM_PROMPT, /returned node_id and node_version/i);
  assert.match(CHAT_AGENT_SYSTEM_PROMPT, /request_image_generation/i);
  assert.match(CHAT_AGENT_SYSTEM_PROMPT, /Use JSON only when the user explicitly requests JSON/i);
  assert.match(CHAT_AGENT_SYSTEM_PROMPT, /Do not ask for optional scene details first/i);
  assert.doesNotMatch(CHAT_AGENT_SYSTEM_PROMPT, /ALWAYS format the prompt as a JSON object/i);
  assert.doesNotMatch(CHAT_AGENT_SYSTEM_PROMPT, /Put ONLY the JSON/i);
  assert.doesNotMatch(CHAT_AGENT_SYSTEM_PROMPT, /8k, highly detailed/i);
});
