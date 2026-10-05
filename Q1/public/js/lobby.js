/**
 * Lobby Manager — handles room creation, joining, and waiting room UI
 */

class LobbyManager {
  constructor() {
    // Tab switching
    this.tabBtns = document.querySelectorAll('.tab-btn');
    this.tabContents = {
      create: document.getElementById('tab-create'),
      join: document.getElementById('tab-join')
    };

    // Create room
    this.createNameInput = document.getElementById('create-name');
    this.roundsInput = document.getElementById('setting-rounds');
    this.timeInput = document.getElementById('setting-time');
    this.categorySelect = document.getElementById('setting-category');
    this.customWordsInput = document.getElementById('custom-words');
    this.createBtn = document.getElementById('btn-create');

    // Join room
    this.joinNameInput = document.getElementById('join-name');
    this.joinCodeInput = document.getElementById('join-code');
    this.joinBtn = document.getElementById('btn-join');

    // Waiting room
    this.roomCodeDisplay = document.getElementById('display-room-code');
    this.roundsDisplay = document.getElementById('display-rounds');
    this.timeDisplay = document.getElementById('display-time');
    this.playerListEl = document.getElementById('waiting-player-list');
    this.startBtn = document.getElementById('btn-start');
    this.waitingMsg = document.getElementById('waiting-msg');
    this.copyLinkBtn = document.getElementById('btn-copy-link');
    this.inviteLinkInput = document.getElementById('display-invite-link');

    // Callbacks
    this.onCreate = null;
    this.onJoin = null;
    this.onStart = null;

    this._setupEvents();
    this._checkUrlForRoom();
  }

  _setupEvents() {
    // Tabs
    this.tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        this.tabBtns.forEach(b => b.classList.remove('active'));
        Object.values(this.tabContents).forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
        this.tabContents[btn.dataset.tab].classList.add('active');
      });
    });

    // Steppers and manual input
    const clampInput = (input) => {
      let val = parseInt(input.value) || parseInt(input.min);
      val = Math.max(parseInt(input.min), Math.min(parseInt(input.max), val));
      input.value = val;
    };

    document.querySelectorAll('.stepper-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const input = document.getElementById(btn.dataset.target);
        const dir = parseInt(btn.dataset.dir);
        let val = parseInt(input.value) || parseInt(input.min);
        val += dir;
        input.value = val;
        clampInput(input);
      });
    });

    this.roundsInput.addEventListener('change', () => clampInput(this.roundsInput));
    this.timeInput.addEventListener('change', () => clampInput(this.timeInput));

    // Create room
    this.createBtn.addEventListener('click', () => {
      const name = this.createNameInput.value.trim();
      if (!name) {
        showToast('Please enter your name', 'error');
        return;
      }

      const customWords = this.customWordsInput.value
        .split(',')
        .map(w => w.trim())
        .filter(w => w.length > 0);

      if (this.onCreate) {
        this.onCreate({
          playerName: name,
          settings: {
            rounds: parseInt(this.roundsInput.value),
            drawTime: parseInt(this.timeInput.value),
            category: this.categorySelect.value,
            customWords
          }
        });
      }
    });

    // Join room
    this.joinBtn.addEventListener('click', () => {
      const name = this.joinNameInput.value.trim();
      const code = this.joinCodeInput.value.trim().toUpperCase();

      if (!name) {
        showToast('Please enter your name', 'error');
        return;
      }
      if (!code) {
        showToast('Please enter a room code', 'error');
        return;
      }

      if (this.onJoin) {
        this.onJoin({ playerName: name, roomCode: code });
      }
    });

    // Start game
    this.startBtn.addEventListener('click', () => {
      if (this.onStart) this.onStart();
    });

    // Copy invite link
    this.copyLinkBtn.addEventListener('click', () => {
      const url = this.inviteLinkInput.value;
      
      // Select the text for visual feedback
      this.inviteLinkInput.select();
      this.inviteLinkInput.setSelectionRange(0, 99999);
      
      navigator.clipboard.writeText(url).then(() => {
        showToast('Invite link copied!', 'success');
      }).catch(() => {
        // Fallback for older browsers
        try {
          document.execCommand('copy');
          showToast('Invite link copied!', 'success');
        } catch (err) {
          showToast(`Please manually copy the link.`, 'info');
        }
      });
    });

    // Enter key on inputs
    this.createNameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.createBtn.click();
    });
    this.joinNameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.joinBtn.click();
    });
    this.joinCodeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.joinBtn.click();
    });
  }

  /**
   * Check URL for ?room= parameter and auto-switch to join tab
   */
  _checkUrlForRoom() {
    const params = new URLSearchParams(window.location.search);
    const roomCode = params.get('room');
    if (roomCode) {
      // Switch to join tab
      this.tabBtns.forEach(b => b.classList.remove('active'));
      Object.values(this.tabContents).forEach(t => t.classList.remove('active'));
      document.querySelector('[data-tab="join"]').classList.add('active');
      this.tabContents.join.classList.add('active');
      this.joinCodeInput.value = roomCode.toUpperCase();
    }
  }

  /**
   * Show the waiting room with room data
   */
  showWaitingRoom(roomCode, settings, isHost) {
    this.roomCodeDisplay.textContent = roomCode;
    this.roundsDisplay.textContent = settings.rounds;
    this.timeDisplay.textContent = settings.drawTime;

    if (isHost) {
      this.startBtn.style.display = 'block';
      this.waitingMsg.style.display = 'none';
    } else {
      this.startBtn.style.display = 'none';
      this.waitingMsg.style.display = 'block';
    }

    // Update URL with room code
    const url = new URL(window.location);
    url.searchParams.set('room', roomCode);
    window.history.replaceState({}, '', url);
    
    // Set invite link explicitly
    this.inviteLinkInput.value = url.href;
  }

  /**
   * Update the player list in the waiting room
   */
  updatePlayerList(players) {
    this.playerListEl.innerHTML = '';

    for (const player of players) {
      const item = document.createElement('div');
      item.className = 'player-item';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'player-name';
      nameSpan.textContent = player.name;

      if (player.isHost) {
        const badge = document.createElement('span');
        badge.className = 'host-badge';
        badge.textContent = 'HOST';
        nameSpan.appendChild(badge);
      }

      item.appendChild(nameSpan);
      this.playerListEl.appendChild(item);
    }
  }

  /**
   * Update settings display
   */
  updateSettings(settings) {
    this.roundsDisplay.textContent = settings.rounds;
    this.timeDisplay.textContent = settings.drawTime;
  }
}
