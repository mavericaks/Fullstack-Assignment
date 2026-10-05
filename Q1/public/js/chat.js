/**
 * Chat Manager — handles chat messaging and display
 */

class ChatManager {
  constructor() {
    this.container = document.getElementById('chat-messages');
    this.input = document.getElementById('chat-input');
    this.sendBtn = document.getElementById('btn-send');

    this.onSend = null; // callback when user sends a message

    this._setupEvents();
  }

  _setupEvents() {
    this.sendBtn.addEventListener('click', () => this._send());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._send();
    });
  }

  _send() {
    const message = this.input.value.trim();
    if (!message) return;

    if (this.onSend) this.onSend(message);
    this.input.value = '';
  }

  /**
   * Add a message to the chat display
   * @param {string} player - player name (null for system messages)
   * @param {string} message - the message text
   * @param {string} type - 'chat', 'system', 'correct', 'close', 'guessed-chat', 'drawer-chat'
   */
  addMessage(player, message, type = 'chat') {
    const div = document.createElement('div');
    div.className = `chat-msg ${type}`;

    if (type === 'system') {
      div.textContent = message;
    } else if (type === 'correct') {
      div.textContent = message;
    } else {
      const nameSpan = document.createElement('span');
      nameSpan.className = 'msg-player';
      nameSpan.textContent = player + ':';

      const msgSpan = document.createElement('span');
      msgSpan.textContent = ' ' + message;

      div.appendChild(nameSpan);
      div.appendChild(msgSpan);
    }

    this.container.appendChild(div);
    this.container.scrollTop = this.container.scrollHeight;
  }

  /**
   * Clear all messages
   */
  clear() {
    this.container.innerHTML = '';
  }

  /**
   * Enable or disable the chat input
   */
  setEnabled(enabled) {
    this.input.disabled = !enabled;
    this.sendBtn.disabled = !enabled;
  }
}
