// ──────── IRONMAN AI CHAT ────────
const input = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');
const messagesContainer = document.getElementById('messages');
const chatContainer = document.getElementById('chat-container');
const typingIndicator = document.getElementById('typing-indicator');
const resetBtn = document.getElementById('reset-btn');

let sessionId = 'conv_' + Date.now();
let isProcessing = false;
let abortController = null;

// Auto-resize textarea
input.addEventListener('input', () => {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  sendBtn.disabled = !input.value.trim();
});

// Send on Enter (Shift+Enter for newline)
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

sendBtn.addEventListener('click', sendMessage);
resetBtn.addEventListener('click', resetConversation);

// ---- Markdown-ish renderer ----
function renderContent(text) {
  // Escape HTML first
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Code blocks (```...```)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const langClass = lang ? ` class="language-${lang}"` : '';
    return `<pre><code${langClass}>${htmlEscape(code.trim())}</code></pre>`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Italic
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Line breaks
  html = html.replace(/\n/g, '<br>');

  return html;
}

function htmlEscape(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---- Messages ----
function addMessage(role, content, isStreaming = false) {
  const div = document.createElement('div');
  div.className = `message ${role}`;

  const header = role === 'assistant' ? 'Ironman AI' : '';
  const rendered = role === 'assistant' ? renderContent(content) : content.replace(/\n/g, '<br>');

  div.innerHTML = `
    ${header ? `<div class="bubble-header">${header}</div>` : ''}
    <div class="bubble">
      <div class="bubble-content">${rendered}</div>
    </div>
  `;

  if (isStreaming) {
    // Find existing streaming message or add new
    const existing = messagesContainer.querySelector('.message.streaming');
    if (existing) {
      existing.querySelector('.bubble-content').innerHTML = rendered;
      scrollToBottom();
      return existing;
    }
    div.classList.add('streaming');
  }

  messagesContainer.appendChild(div);
  scrollToBottom();
  return div;
}

function scrollToBottom() {
  setTimeout(() => {
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }, 10);
}

function showTyping() { typingIndicator.classList.remove('hidden'); scrollToBottom(); }
function hideTyping() { typingIndicator.classList.add('hidden'); }

// ---- Send Message ----
async function sendMessage() {
  const text = input.value.trim();
  if (!text || isProcessing) return;

  input.value = '';
  input.style.height = 'auto';
  sendBtn.disabled = true;
  isProcessing = true;

  // Add user message
  addMessage('user', text);

  // Show typing indicator
  showTyping();

  abortController = new AbortController();

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, sessionId }),
      signal: abortController.signal,
    });

    if (!response.ok) {
      const err = await response.text();
      addMessage('assistant', `Error: ${err}`);
      hideTyping();
      isProcessing = false;
      sendBtn.disabled = !input.value.trim();
      return;
    }

    hideTyping();

    // Read the stream
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let assistantMsg = null;
    let fullContent = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          if (parsed.content) {
            fullContent += parsed.content;
            if (!assistantMsg) {
              assistantMsg = addMessage('assistant', fullContent, true);
            } else {
              assistantMsg.querySelector('.bubble-content').innerHTML = renderContent(fullContent);
              scrollToBottom();
            }
          }
          if (parsed.error) {
            addMessage('assistant', `Error: ${parsed.error}`);
          }
        } catch {}
      }
    }

    // Final render
    if (assistantMsg) {
      assistantMsg.querySelector('.bubble-content').innerHTML = renderContent(fullContent);
    }

  } catch (err) {
    if (err.name === 'AbortError') return;
    hideTyping();
    addMessage('assistant', `Connection error: ${err.message}`);
  }

  isProcessing = false;
  sendBtn.disabled = !input.value.trim();
}

// ---- Reset ----
async function resetConversation() {
  if (isProcessing && abortController) {
    abortController.abort();
    isProcessing = false;
  }

  await fetch('/api/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  });

  // Clear messages and re-add welcome
  messagesContainer.innerHTML = `
    <div class="message welcome">
      <div class="bubble-header">Ironman AI</div>
      <div class="bubble">
        <div class="bubble-content">
Hey there! I'm <strong>Ironman AI</strong> — your assistant. How can I help you today?</div>
      </div>
    </div>
  `;

  sessionId = 'conv_' + Date.now();
  hideTyping();
  sendBtn.disabled = true;
}

// ---- Init ----
input.focus();
