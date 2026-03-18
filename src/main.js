import { PageFlip } from 'page-flip';
import './style.css';

// ============================
// BELAY — Digital Flipbook App
// ============================

class FlipbookApp {
  constructor() {
    this.pageFlip = null;
    this.isNarrationPlaying = true;
    this.narrationAudio = null;
    this.narrationQueue = [];
    this.currentQueueIndex = 0;
    this.narrationSessionId = 0;
    this.autoAdvanceTimer = null;
    this.narrationDebounceTimer = null;
    this.pageTurnSound = null;
    this.currentPage = 0;
    this.currentManualPage = null;
    this.zoomLevel = window.innerWidth < 640 ? 85 : 100;
    this._resizeBound = null;

    this.init();
  }

  init() {
    this.createParticles();
    this.waitForReady();
  }

  // --- Loading Screen ---
  waitForReady() {
    // Wait for images to load, then initialize flipbook WHILE HIDDEN,
    // so the raw HTML page structure never flashes to the user.
    const imgs = document.querySelectorAll('.page-illustration img, .cover-image');
    const vids = document.querySelectorAll('.page-illustration video');
    let loaded = 0;
    const total = imgs.length + vids.length;
    const minLoadTime = 2500;
    const startTime = Date.now();

    const onAllReady = () => {
      if (this._readyFired) return;
      this._readyFired = true;

      // 1. Initialize flipbook while app is still hidden
      this.initFlipbook();
      this.initControls();
      this.initSlider();
      this.initKeyboard();
      this.initPageSpeakers();

      // 2. Wait for minimum load time, then reveal
      const elapsed = Date.now() - startTime;
      const remainingDelay = Math.max(300, minLoadTime - elapsed);

      setTimeout(() => {
        this.revealApp();
      }, remainingDelay);
    };

    if (total === 0) {
      setTimeout(onAllReady, minLoadTime);
      return;
    }

    const onLoad = () => {
      loaded++;
      if (loaded >= total) onAllReady();
    };

    imgs.forEach(img => {
      if (img.complete) {
        onLoad();
      } else {
        img.addEventListener('load', onLoad);
        img.addEventListener('error', onLoad);
      }
    });

    vids.forEach(vid => {
      if (vid.readyState >= 2) {
        onLoad();
      } else {
        vid.addEventListener('canplay', onLoad, { once: true });
        vid.addEventListener('error', onLoad, { once: true });
      }
    });

    // Fallback timeout — don't wait forever
    setTimeout(onAllReady, 6000);
  }

  revealApp() {
    if (this._revealed) return;
    this._revealed = true;

    const overlay = document.getElementById('loading-overlay');
    const app = document.getElementById('app');

    // Make the app visible first (it's underneath the overlay)
    app.classList.remove('hidden');
    requestAnimationFrame(() => {
      app.classList.add('visible');
    });

    // Then fade out the overlay on top
    setTimeout(() => {
      overlay.classList.add('fade-out');
    }, 50);

    setTimeout(() => {
      overlay.style.display = 'none';
    }, 900);
  }

  // --- Flipbook Initialization ---
  initFlipbook(startPage = 0) {
    const bookEl = document.getElementById('book');

    // Calculate dimensions based on viewport + zoom
    const { width, height } = this.calculateBookSize();

    this.pageFlip = new PageFlip(bookEl, {
      width: width,
      height: height,
      size: 'fixed',
      maxShadowOpacity: 0.6,
      showCover: true,
      mobileScrollSupport: false,
      flippingTime: 800,
      usePortrait: window.innerWidth <= 900,
      startZIndex: 0,
      autoSize: false,
      drawShadow: true,
      startPage: startPage,
      clickEventForward: true,
      useMouseEvents: true,
      swipeDistance: 30,
      showPageCorners: true,
    });

    // Load pages from HTML
    this.pageFlip.loadFromHTML(document.querySelectorAll('.page'));

    // Initialize video sequence handlers
    this.initVideoSequences();

    // Listen for page flip events
    this.pageFlip.on('flip', (e) => {
      this.onPageFlip(e.data);
    });

    this.pageFlip.on('changeState', (e) => {
      if (e.data === 'flipping') {
        this.playPageTurnSound();
      }
    });

    // Handle window resize (only bind once)
    if (!this._resizeBound) {
      this._resizeBound = () => this.handleResize();
      window.addEventListener('resize', this._resizeBound);
    }

    this.updatePageIndicator(startPage);
  }

  calculateBookSize() {
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const isMobile = vw <= 900;

    // Determine target aspect ratio (width / height)
    const targetRatio = 0.66; // fixed: novel

    if (isMobile) {
      // Portrait / single-page mode - fill mobile screen optimally
      // But we still attempt to respect ratio
      let mWidth = Math.min(vw - 20, 600);
      let mHeight = mWidth / targetRatio;
      
      const maxMHeight = vh - 120;
      if (mHeight > maxMHeight) {
        mHeight = maxMHeight;
        mWidth = mHeight * targetRatio;
      }
      return { width: Math.round(mWidth), height: Math.round(mHeight) };
    }

    // Desktop: each page is part of a 2-page spread
    const maxBookWidth = vw - 140; // space for nav arrows
    const maxPageWidth = maxBookWidth / 2;
    const maxHeight = vh - 110; // header + controls bar

    // We want to maximize the size while maintaining targetRatio
    let pageHeight = maxHeight;
    let pageWidth = pageHeight * targetRatio;

    // If it's too wide for the screen, constrain by width instead
    if (pageWidth > maxPageWidth) {
      pageWidth = maxPageWidth;
      pageHeight = pageWidth / targetRatio;
    }

    return {
      width: Math.round(pageWidth),
      height: Math.round(pageHeight)
    };
  }

  handleResize() {
    if (!this.pageFlip) return;
    clearTimeout(this._resizeTimer);
    this._resizeTimer = setTimeout(() => {
      // For window resize, we DO want to rebuild to adapt to new dimensions
      const currentPage = this.pageFlip.getCurrentPageIndex();
      this.pageFlip.destroy();
      
      // Need to reload the page completely because StPageFlip destroys the DOM
      // A full fresh reload is the safest way to handle window resize with this library
      window.location.reload();
    }, 500);
  }

  // --- Video Sequence Handler ---
  initVideoSequences() {
    const sequenceVideos = document.querySelectorAll('video[data-sequence]');
    sequenceVideos.forEach(vid => {
      const sequence = vid.dataset.sequence.split(',');
      let currentIndex = 0;

      vid.addEventListener('ended', () => {
        currentIndex = (currentIndex + 1) % sequence.length;
        vid.src = `/videos/${sequence[currentIndex]}`;
        vid.play().catch(e => console.log('Video play failed:', e));
      });
    });
  }

  // --- Page Events ---
  onPageFlip(pageIndex) {
    this.currentPage = pageIndex;
    this.updatePageIndicator(pageIndex);
    
    // Always stop any playing narration when flipping
    this.stopNarrationOnly();

    // Auto-trigger narration if it's active
    if (this.isNarrationPlaying) {
      // Debounce narration to handle rapid page turns (like slider)
      if (this.narrationDebounceTimer) {
        clearTimeout(this.narrationDebounceTimer);
      }
      this.narrationDebounceTimer = setTimeout(() => {
        this.narrateCurrentPage();
        this.narrationDebounceTimer = null;
      }, 300);
    }

    // Handle video playback for current page
    this.playVideosOnCurrentPage(pageIndex);
  }

  playVideosOnCurrentPage(forcedIndex) {
    const pageIndex = (forcedIndex !== undefined) ? forcedIndex : this.currentPage;
    const isMobile = window.innerWidth <= 900;
    const totalPages = this.pageFlip ? this.pageFlip.getPageCount() : 0;
    
    // 1. Determine which pages SHOULD be visible
    const visibleIndices = [pageIndex];
    if (!isMobile) {
      // In desktop mode, we see a spread if not at the very ends
      if (pageIndex > 0 && pageIndex < totalPages - 1) {
        // StPageFlip spread logic: usually 1-2, 3-4, etc.
        const partner = (pageIndex % 2 === 0) ? pageIndex - 1 : pageIndex + 1;
        if (partner >= 0 && partner < totalPages) {
          visibleIndices.push(partner);
        }
      } else if (pageIndex === 0 && totalPages > 1) {
        // Just the cover, but some themes show the inner right too
      }
    }

    // 2. Identify all video elements and their target states
    const allPages = document.querySelectorAll('.page');
    const allVids = document.querySelectorAll('.page-illustration video');
    const targetVids = [];

    visibleIndices.forEach(idx => {
      const pageEl = allPages[idx];
      if (pageEl) {
        pageEl.querySelectorAll('video').forEach(v => targetVids.push(v));
      }
    });

    // 3. Apply play/pause states
    allVids.forEach(v => {
      if (targetVids.includes(v)) {
        if (v.paused) {
          v.play().catch(e => {
            // Silently catch autoplay blocks
          });
        }
      } else {
        if (!v.paused) v.pause();
      }
    });

    // 4. Retry once to handle any dynamic DOM updates from the library
    if (!this._videoRetryTimer) {
      this._videoRetryTimer = setTimeout(() => {
        this._videoRetryTimer = null;
        this.playVideosOnCurrentPage();
      }, 300);
    }
  }

  updatePageIndicator(pageIndex) {
    const indicator = document.getElementById('page-indicator-slider');
    const totalPages = this.pageFlip ? this.pageFlip.getPageCount() : 0;

    if (indicator) {
      if (pageIndex === 0) {
        indicator.textContent = 'Pabalat';
      } else if (pageIndex === 1 || pageIndex === 2) {
        indicator.textContent = 'Talaan ng Nilalaman';
      } else if (pageIndex >= totalPages - 1) {
        indicator.textContent = 'Likod ng Aklat';
      } else {
        indicator.textContent = `Pahina ${pageIndex - 2} ng ${totalPages - 4}`;
      }
    }

    // Sync page slider
    const pageSlider = document.getElementById('page-slider');
    if (pageSlider) {
      pageSlider.max = totalPages - 1;
      pageSlider.value = pageIndex;
    }

    // Update dynamic 3D page edge thickness
    this.updatePageThickness(pageIndex, totalPages);
  }

  updatePageThickness(pageIndex, totalPages) {
    if (totalPages <= 0) return;
    // Max thickness in purely visual shadow layers
    const maxLayers = 16;
    
    // Scale layers based on percentage of pages passed
    const pagesLeft = pageIndex;
    const pagesRight = Math.max(0, totalPages - pageIndex - 1);
    
    let leftLayers = Math.max(1, Math.round((pagesLeft / totalPages) * maxLayers));
    let rightLayers = Math.max(1, Math.round((pagesRight / totalPages) * maxLayers));
    
    // Avoid showing shadow if no pages left (like on front cover's left)
    if (pageIndex === 0) leftLayers = 0;
    if (pageIndex >= totalPages - 1) rightLayers = 0;

    const buildShadow = (layers, direction) => {
      if (layers === 0) return 'none';
      let shadow = [];
      const dirMult = direction === 'left' ? -1 : 1;
      for (let i = 1; i <= layers; i++) {
        // Creates uneven/realistic paper stack effect:
        // Main page edge is bright, gap between pages is dark grey
        const color = (i % 2 !== 0) ? 'var(--parchment-edge)' : '#2b2a27'; // Dark gap vs light page
        // Slight vertical offset for "uneven" natural pages
        const yOffset = (i % 3 === 0) ? 0.5 : ((i % 5 === 0) ? -0.5 : 0);
        shadow.push(`${i * dirMult}px ${yOffset}px 0 ${color}`);
      }
      return shadow.join(', ');
    };

    document.documentElement.style.setProperty('--left-page-shadow', buildShadow(leftLayers, 'left'));
    document.documentElement.style.setProperty('--right-page-shadow', buildShadow(rightLayers, 'right'));
  }

  // --- Navigation Controls ---
  initControls() {
    const prevBtn = document.getElementById('btn-prev');
    const nextBtn = document.getElementById('btn-next');
    const narrationBtn = document.getElementById('btn-narration');
    const settingsBtn = document.getElementById('btn-settings');
    const settingsPanel = document.getElementById('settings-panel');

    // Enable narration by default in UI
    if (this.isNarrationPlaying && narrationBtn) {
      narrationBtn.classList.add('active');
    }

    prevBtn.addEventListener('click', () => {
      this.pageFlip.flipPrev();
    });

    nextBtn.addEventListener('click', () => {
      this.pageFlip.flipNext();
    });


    narrationBtn.addEventListener('click', () => {
      this.toggleNarration(narrationBtn);
    });

    if (settingsBtn && settingsPanel) {
      settingsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        settingsPanel.classList.toggle('active');
        settingsBtn.classList.toggle('active');
      });

      // Close settings when clicking outside
      document.addEventListener('click', (e) => {
        if (!settingsPanel.contains(e.target) && !settingsBtn.contains(e.target)) {
          settingsPanel.classList.remove('active');
          settingsBtn.classList.remove('active');
        }
      });
    }
  }

  // --- Sliders (Zoom, Page Navigation, Text Size, Spacing) ---
  initSlider() {
    // 1. Zoom Slider
    const zoomSlider = document.getElementById('size-slider');
    const zoomLabel = document.getElementById('size-label');
    const wrapper = document.querySelector('.book-wrapper');
    const appContainer = document.querySelector('.app');

    if (zoomSlider && zoomLabel && wrapper) {
      zoomSlider.value = this.zoomLevel;
      zoomLabel.textContent = `${this.zoomLevel}%`;

      const updateZoom = (val) => {
        this.zoomLevel = val;
        zoomLabel.textContent = `${val}%`;
        const scale = val / 100;
        wrapper.style.transform = `scale(${scale})`;
        wrapper.style.transformOrigin = 'center center';
        if (appContainer) {
          appContainer.style.overflow = val > 100 ? 'auto' : 'hidden';
        }
      };

      // Apply initial zoom
      updateZoom(this.zoomLevel);

      zoomSlider.addEventListener('input', (e) => {
        updateZoom(parseInt(e.target.value, 10));
      });
    }

    // 2. Page Slider
    const pageSlider = document.getElementById('page-slider');
    if (pageSlider && this.pageFlip) {
      const totalPages = this.pageFlip.getPageCount();
      pageSlider.max = totalPages - 1;
      pageSlider.value = this.currentPage;

      pageSlider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        this.pageFlip.turnToPage(val);
      });
    }

    // 3. Text Size Slider
    const textSizeSlider = document.getElementById('text-size-slider');
    const textSizeLabel = document.getElementById('text-size-label');
    if (textSizeSlider && textSizeLabel) {
      textSizeSlider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        textSizeLabel.textContent = `${val}%`;
        // Base is 0.78rem
        const rem = (val / 100) * 0.78;
        document.documentElement.style.setProperty('--story-text-size', `${rem}rem`);
      });
    }

    // 4. Vertical Spacing Slider
    const spacingSlider = document.getElementById('spacing-slider');
    const spacingLabel = document.getElementById('spacing-label');
    if (spacingSlider && spacingLabel) {
      spacingSlider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10) / 10;
        spacingLabel.textContent = val.toFixed(1);
        document.documentElement.style.setProperty('--story-line-height', val);
      });
    }
  }



  // --- Keyboard Navigation ---
  initKeyboard() {
    document.addEventListener('keydown', (e) => {
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          e.preventDefault();
          this.pageFlip.flipNext();
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          e.preventDefault();
          this.pageFlip.flipPrev();
          break;
        case 'Home':
          e.preventDefault();
          this.pageFlip.turnToPage(0);
          break;
        case 'End':
          e.preventDefault();
          this.pageFlip.turnToPage(this.pageFlip.getPageCount() - 1);
          break;
      }
    });
  }

  // --- Audio System ---
  initAudio() {
    // Create page turn sound using Web Audio API (synthetic)
    this.audioContext = null;
    try {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      console.log('Web Audio API not available');
    }
  }

  playPageTurnSound() {
    if (!this.audioContext) return;

    try {
      // Resume audio context if suspended (Chrome autoplay policy)
      if (this.audioContext.state === 'suspended') {
        this.audioContext.resume();
      }

      const now = this.audioContext.currentTime;

      // Create a "paper rustle" sound with noise
      const bufferSize = this.audioContext.sampleRate * 0.3; // 300ms
      const buffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
      const data = buffer.getChannelData(0);

      for (let i = 0; i < bufferSize; i++) {
        // White noise shaped by envelope
        const t = i / bufferSize;
        const envelope = Math.pow(Math.sin(t * Math.PI), 0.5) * (1 - t * 0.7);
        data[i] = (Math.random() * 2 - 1) * envelope * 0.15;
      }

      const source = this.audioContext.createBufferSource();
      source.buffer = buffer;

      // Filter to make it sound more like paper
      const filter = this.audioContext.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(2000, now);
      filter.Q.setValueAtTime(0.5, now);

      // Gain envelope
      const gain = this.audioContext.createGain();
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.3, now + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);

      source.connect(filter);
      filter.connect(gain);
      gain.connect(this.audioContext.destination);

      source.start(now);
      source.stop(now + 0.35);
    } catch (e) {
      // Audio playback failed silently
    }
  }


  toggleNarration(btn) {
    if (this.isNarrationPlaying) {
      this.stopNarration();
      btn.classList.remove('active');
    } else {
      btn.classList.add('active');
      this.isNarrationPlaying = true;
      this.narrateCurrentPage();
    }
  }

  stopNarration() {
    this.isNarrationPlaying = false;
    this.stopNarrationOnly();
  }

  narrateCurrentPage() {
    if (!this.isNarrationPlaying) return;

    this.stopNarrationOnly();

    // Increment session ID to cancel any previous play cycles
    this.narrationSessionId++;
    const currentSessionId = this.narrationSessionId;

    const currentPageIdx = this.pageFlip.getCurrentPageIndex();
    const isMobile = window.innerWidth <= 900;
    
    // Clear and build new queue
    this.narrationQueue = [];
    this.currentQueueIndex = 0;

    // Add current page
    this.narrationQueue.push(currentPageIdx);

    // If desktop (spread view) and not cover/back, add the next page too
    const totalPages = this.pageFlip.getPageCount();
    if (!isMobile && currentPageIdx > 0 && currentPageIdx < totalPages - 1) {
      const currentAudio = this.getAudioFileForPage(currentPageIdx);
      const nextAudio = this.getAudioFileForPage(currentPageIdx + 1);
      
      // Only queue the second page if it has different audio
      if (nextAudio && nextAudio !== currentAudio) {
        this.narrationQueue.push(currentPageIdx + 1);
      }
    }

    this.playNextInQueue(currentSessionId);
  }

  stopNarrationOnly() {
    if (this.narrationAudioElement) {
      this.narrationAudioElement.pause();
      this.narrationAudioElement.src = '';
    }
    this.currentManualPage = null;
    
    // Cancel any pending auto-advance
    if (this.autoAdvanceTimer) {
      clearTimeout(this.autoAdvanceTimer);
      this.autoAdvanceTimer = null;
    }

    // Cancel any pending debounce
    if (this.narrationDebounceTimer) {
      clearTimeout(this.narrationDebounceTimer);
      this.narrationDebounceTimer = null;
    }

    // Invalidate current session
    this.narrationSessionId++;

    // Remove highlight
    document.querySelectorAll('.page-speaker-btn').forEach(b => b.classList.remove('active-narration'));
    
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  }

  playNextInQueue(sessionId) {
    if (sessionId !== this.narrationSessionId || !this.isNarrationPlaying) return;

    if (this.currentQueueIndex >= this.narrationQueue.length) {
      if (this.isNarrationPlaying) {
        const lastPageIdx = this.narrationQueue[this.narrationQueue.length - 1];
        if (lastPageIdx < 46) {
          this.autoAdvanceTimer = setTimeout(() => {
            if (sessionId === this.narrationSessionId && this.isNarrationPlaying) {
              this.pageFlip.flipNext();
            }
          }, 1000);
        }
      }
      return;
    }

    const pageIdx = this.narrationQueue[this.currentQueueIndex];
    const audioFile = this.getAudioFileForPage(pageIdx);

    if (!audioFile) {
      this.currentQueueIndex++;
      this.playNextInQueue(sessionId);
      return;
    }

    // Use persistent audio element if possible
    if (!this.narrationAudioElement) {
        this.narrationAudioElement = new Audio();
        this.narrationAudioElement.volume = 1.0;
        
        this.narrationAudioElement.addEventListener('ended', () => {
            if (this.currentSessionIdForEvent === this.narrationSessionId) {
                this.currentQueueIndex++;
                this.playNextInQueue(this.narrationSessionId);
            }
        });
    }

    this.currentSessionIdForEvent = sessionId;
    this.narrationAudioElement.src = `./audio/narration/${audioFile}`;
    this.highlightSpeaker(pageIdx);

    this.narrationAudioElement.play().catch(err => {
      console.warn(`Failed to play narration: ${audioFile}`, err);
      if (sessionId === this.narrationSessionId) {
        this.currentQueueIndex++;
        this.playNextInQueue(sessionId);
      }
    });

    // Ensure videos are still playing when audio starts
    this.playVideosOnCurrentPage();
  }

  initPageSpeakers() {
    const storyPages = document.querySelectorAll('.story-page');
    storyPages.forEach(page => {
      const pageNumEl = page.querySelector('.page-number');
      if (!pageNumEl) return;
      
      const pageIdx = parseInt(pageNumEl.textContent);
      if (isNaN(pageIdx) || pageIdx < 1 || pageIdx > 44) return;
      
      const libPageIdx = pageIdx + 2; // Cover(0), Inner(1), TOC(2), Page 1(3)

      // Create speaker button
      const btn = document.createElement('button');
      btn.className = 'page-speaker-btn';
      btn.id = `speaker-page-${libPageIdx}`;
      btn.setAttribute('aria-label', `Basahin ang pahina ${pageIdx}`);
      btn.setAttribute('title', 'Basahin ang pahinang ito');
      
      btn.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
        </svg>
      `;

      const handleTrigger = (e) => {
        e.stopPropagation();
        if (e.cancelable) e.preventDefault();
        this.playPageAudio(pageIdx);
      };

      // Handle touch and click separately for maximum responsiveness and flip prevention
      btn.addEventListener('touchstart', handleTrigger, { passive: false });
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        // If touch already handled it, click might be prevented by preventDefault above.
        // If not, we play it here.
        this.playPageAudio(libPageIdx);
      });

      // Prevent PageFlip library from capturing these as gestures in all phases
      const preventFlip = (e) => {
        e.stopPropagation();
      };
      btn.addEventListener('mousedown', preventFlip);
      btn.addEventListener('pointerdown', preventFlip);

      page.appendChild(btn);
    });
  }

  highlightSpeaker(pageIdx) {
    // Remove active class from all
    document.querySelectorAll('.page-speaker-btn').forEach(b => b.classList.remove('active-narration'));
    // Add to specific one
    const btn = document.getElementById(`speaker-page-${pageIdx}`);
    if (btn) btn.classList.add('active-narration');
  }

  getAudioFileForPage(pageIdx) {
    const storyPageNum = pageIdx - 2; // Index 3 is Story Page 1
    if (storyPageNum >= 1 && storyPageNum <= 36) {
      return `scene${storyPageNum}.mp3`;
    } else if (storyPageNum === 37 || storyPageNum === 38) {
      return `scene38.mp3`;
    } else if (storyPageNum >= 39 && storyPageNum <= 44) {
      return `scene${storyPageNum}.mp3`;
    }
    return null;
  }

  // Manual Trigger for specific page
  playPageAudio(pageIdx) {
    if (this.currentManualPage === pageIdx) {
      this.stopNarrationOnly();
      return;
    }

    this.stopNarrationOnly();
    
    const audioFile = this.getAudioFileForPage(pageIdx);
    if (!audioFile) return;

    this.currentManualPage = pageIdx;
    this.highlightSpeaker(pageIdx);

    if (!this.narrationAudioElement) {
        this.narrationAudioElement = new Audio();
        this.narrationAudioElement.volume = 1.0;
        
        this.narrationAudioElement.addEventListener('ended', () => {
            if (this.currentSessionIdForEvent === this.narrationSessionId) {
                if (this.currentManualPage) {
                    const finishedPage = this.currentManualPage;
                    this.currentManualPage = null;
                    this.highlightSpeaker(-1);
                } else {
                    this.currentQueueIndex++;
                    this.playNextInQueue(this.narrationSessionId);
                }
            }
        });
    }

    this.currentSessionIdForEvent = this.narrationSessionId;
    this.narrationAudioElement.src = `./audio/narration/${audioFile}`;

    this.narrationAudioElement.play().catch(err => {
      console.warn(err);
      this.currentManualPage = null;
    });

    // Sync videos
    this.playVideosOnCurrentPage();
  }


  // --- Background Particles ---
  createParticles() {
    const container = document.getElementById('bg-particles');
    const count = 30;

    for (let i = 0; i < count; i++) {
      const particle = document.createElement('div');
      particle.className = 'particle';
      particle.style.left = `${Math.random() * 100}%`;
      particle.style.animationDuration = `${12 + Math.random() * 20}s`;
      particle.style.animationDelay = `${Math.random() * 15}s`;
      particle.style.width = `${2 + Math.random() * 3}px`;
      particle.style.height = particle.style.width;
      particle.style.opacity = `${0.1 + Math.random() * 0.3}`;
      container.appendChild(particle);
    }
  }
}

// --- Initialize App ---
document.addEventListener('DOMContentLoaded', () => {
  new FlipbookApp();
});

// Ensure speech synthesis voices are loaded
if (window.speechSynthesis) {
  window.speechSynthesis.onvoiceschanged = () => {
    window.speechSynthesis.getVoices();
  };
}
