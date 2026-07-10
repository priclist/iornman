// ──────── FINDY AI CHAT ────────
const input = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');
const messagesContainer = document.getElementById('messages');
const chatContainer = document.getElementById('chat-container');
const typingIndicator = document.getElementById('typing-indicator');
const resetBtn = document.getElementById('reset-btn');
const headerTitle = document.getElementById('header-title');
const headerSubtitle = document.getElementById('header-subtitle');

let sessionId = 'findy_' + Date.now();
let currentMode = 'default';
let isProcessing = false;
let abortController = null;

// Sidebar items
const chatDefault = document.getElementById('chat-default');
const chatConnected = document.getElementById('chat-connected');

chatDefault.addEventListener('click', () => switchMode('default'));
chatConnected.addEventListener('click', () => switchMode('connected'));

// Auto-resize textarea
input.addEventListener('input', () => {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  sendBtn.disabled = !input.value.trim();
});

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

sendBtn.addEventListener('click', sendMessage);
resetBtn.addEventListener('click', resetConversation);

// ---- Mode Switching ----
function switchMode(mode) {
  if (mode === currentMode) return;

  currentMode = mode;
  sessionId = 'findy_' + Date.now();

  // Update sidebar active state
  document.querySelectorAll('.conv-item').forEach(el => el.classList.remove('active'));
  if (mode === 'default') {
    chatDefault.classList.add('active');
    headerTitle.textContent = 'Findy';
    headerSubtitle.textContent = 'Your AI assistant · Smart · Efficient';
    input.placeholder = 'Ask me anything, sir...';
  } else {
    chatConnected.classList.add('active');
    headerTitle.textContent = 'Findy · Nissan Springs';
    headerSubtitle.textContent = 'Connected to nissansprings.co.za';
    input.placeholder = 'Ask about Nissan Springs, sir...';
  }

  // Clear messages
  messagesContainer.innerHTML = getWelcomeHTML(mode);
  hideTyping();
}

function getWelcomeHTML(mode) {
  if (mode === 'default') {
    return `
      <div class="message welcome">
        <div class="avatar findy-avatar">
          <div class="mini-reactor">
            <div class="mr-ring"></div>
            <div class="mr-core"></div>
          </div>
        </div>
        <div class="bubble">
          <div class="bubble-header">Findy</div>
          <div class="bubble-content">
            At your service, sir. I'm <strong>Findy</strong> — ready to help with whatever you need. What can I do for you?
          </div>
        </div>
      </div>`;
  } else {
    return `
      <div class="message welcome">
        <div class="avatar findy-avatar">
          <div class="mini-reactor">
            <div class="mr-ring"></div>
            <div class="mr-core"></div>
          </div>
        </div>
        <div class="bubble">
          <div class="bubble-header">Findy · Nissan Springs</div>
          <div class="bubble-content">
            Connected to <strong>Nissan Springs</strong> 🏢 — I've studied their website at <strong>nissansprings.co.za</strong>. 
            Ask me about their vehicles, services, promotions, or anything else about the dealership, sir.
          </div>
        </div>
      </div>`;
  }
}

// ---- Markdown-ish renderer ----
function renderContent(text) {
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const langClass = lang ? ` class="language-${lang}"` : '';
    return `<pre><code${langClass}>${htmlEscape(code.trim())}</code></pre>`;
  });

  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
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

  const avatar = role === 'assistant'
    ? `<div class="avatar findy-avatar"><div class="mini-reactor"><div class="mr-ring"></div><div class="mr-core"></div></div></div>`
    : `<div class="avatar user-avatar">👤</div>`;

  const header = role === 'assistant' ? 'FINDY' : 'YOU';
  const rendered = role === 'assistant' ? renderContent(content) : content.replace(/\n/g, '<br>');

  div.innerHTML = `
    ${avatar}
    <div class="bubble">
      <div class="bubble-header">${header}</div>
      <div class="bubble-content">${rendered}</div>
    </div>
  `;

  if (isStreaming) {
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

  addMessage('user', text);
  showTyping();

  abortController = new AbortController();

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, sessionId, mode: currentMode }),
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

  sessionId = 'findy_' + Date.now();
  messagesContainer.innerHTML = getWelcomeHTML(currentMode);
  hideTyping();
  sendBtn.disabled = true;
}

// ---- Init ----
input.focus();
