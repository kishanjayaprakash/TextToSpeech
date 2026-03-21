const displayDiv = document.getElementById("displayDiv");
const hiddenInput = document.getElementById("hiddenInput");
const pdfInput = document.getElementById("pdfInput");
const uploadText = document.getElementById("uploadText");
const voiceSelect = document.getElementById("voiceSelect");
const speedSelect = document.getElementById("speedSelect");
const speakBtn = document.getElementById("speakBtn");
const pauseBtn = document.getElementById("pauseBtn");
const backwardBtn = document.getElementById("backwardBtn");
const forwardBtn = document.getElementById("forwardBtn");
const readingTime = document.getElementById("readingTime");
const progressBar = document.getElementById("progressBar");
const downloadBtn = document.getElementById("downloadBtn");
const downloadLangSelect = document.getElementById("downloadLangSelect");
const downloadStatus = document.getElementById("downloadStatus");
const clearBtn = document.getElementById("clearBtn");
const clearRow = document.getElementById("clearRow");

const IS_MOBILE = window.matchMedia("(max-width: 840px)").matches
               && navigator.maxTouchPoints > 1; //TABLET, MOBILE DETECTION AND FALSE FOR TOUCH SCREEN LAPTOP'S

let currentSpeed      = 1;
let targetScrollTop   = 0;
let scrollFrame       = null;
let voices            = [];
let userSelectedVoice = false;
let isSpeaking        = false;
let isPaused          = false;
let lastCharIndex     = 0;
let fullText          = "";

// Desktop word spans 
let currentHighlight = -1;
let charToSpanMap    = null;

// Mobile sentence state
let sentences = [];
let sentenceSpans = [];
let currentSentence  = -1;

// Mobile utterance queue
let sentenceQueue    = [];
let queueIndex       = 0;
let queueCancelled   = false;

// track last rendered text so we skip rebuilding spans when not needed
let lastRenderedText = "";


//  VOICES
function loadVoices() {
    voices = speechSynthesis.getVoices(); // ASKS BROWSER FOR LIST OF AVAILABLE VOICES
    if (!voices.length) { // IF NO VOICES EXIST SHOWS LOADING VOICES AND EXITS FUNCTION WITH RETURN
        voiceSelect.innerHTML = '<option>Loading voices…</option>'; return; }

    const prev = voiceSelect.value;
    const lang = downloadLangSelect ? downloadLangSelect.value : "en";

    voiceSelect.innerHTML = ""; //EMPTY DROP DOWN
    voices.forEach((v, i) => { //FILLING THE DROPDOWN
        voiceSelect.appendChild(new Option(v.name + " (" + v.lang + ")", i));
    });

    if (userSelectedVoice && prev && voices[prev]) {
        voiceSelect.value = prev;
    } else {
        const best = voices.find(v => v.lang.startsWith(lang)); //SEARCHES FOR FIRST VOICE IF VOICE NOT MANUALLY PICKED
        voiceSelect.value = best ? voices.indexOf(best) : 0; 
    }
}

if (speechSynthesis.onvoiceschanged !== undefined) 
    speechSynthesis.onvoiceschanged = loadVoices;
    loadVoices(); 
    setTimeout(loadVoices, 100); //LOAD VOICES AFTER 100MS
    setTimeout(loadVoices, 500); // 500MS

voiceSelect.addEventListener("change", () => { 
    userSelectedVoice = true; });
downloadLangSelect.addEventListener("change", () => { 
userSelectedVoice = false; 
loadVoices(); });

//SPEED SELECTION
speedSelect.addEventListener("change", () => {
    currentSpeed = parseFloat(speedSelect.value); //CONVERT STRING TO FLOAT LIKE "1.5" TO 1.5
    updateReadingTime(); //RECALCULATES ESTIMATED READING TIME WITH CHANGE IN SPEED
    if (isSpeaking || isPaused) 
    startSpeechFrom(lastCharIndex); //START FROM CURRENT POSITION WITH CHANGED SPEED VALUE
});

//  SENTENCE BUILDER IN MOBILE 
function buildSentences(text) {
    const chunks = text.match(/[^.!?\n]+[.!?\n]*/g) || [text]; //SPLITS TEXTs INTO CHUNKS USING REGEX PATTERN MATCHER
    const result = [];
    let searchFrom = 0;

    for (const chunk of chunks) {
        const trimmed = chunk.trim();
        if (!trimmed) { 
            searchFrom += chunk.length; 
            continue; }

        const charStart = text.indexOf(trimmed, searchFrom);
        const charEnd   = charStart + trimmed.length;
        const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
        //SPLIT BY WHITE SPACES , REMOVE ANY EMPTY STRINGS AND COUNT THEM

        result.push({ text: trimmed, charStart, charEnd, wordCount });
        searchFrom = charEnd;
    }
    return result;
}

function sentenceIndexForChar(charIndex) {
    for (let i = 0; i < sentences.length; i++) {
        if (charIndex >= sentences[i].charStart && charIndex < sentences[i].charEnd) return i;
    }
    return 0;
}

// DSIPLAYS TEXT AND WRAPS THE WORD, SENTENCE OR PLAIN TEXTS IN SPAN TAGS SO THEY CAN BE HIGHLIGHTED WHILE SPEAKING
function renderWords(text) {
    // --- PERF: if text hasn't changed, reuse existing spans instead of rebuilding ---
    if (text === lastRenderedText && displayDiv.children.length > 0) {
        return;
    }
    lastRenderedText = text;

    wordSpans = []; sentenceSpans = [];
    currentHighlight = -1; currentSentence = -1;
    if (!text.trim()) { //EXITS FUNCTION IF TRUE AND DOES NOT RUN REST
        displayDiv.innerHTML = ""; return;
    }

    if (IS_MOBILE) {
        sentences = buildSentences(text);
        // --- PERF: build fragment off-screen to avoid reflow on every appendChild ---
        const frag = document.createDocumentFragment();
        let pos = 0;
        for (const sent of sentences) {
            if (sent.charStart > pos)
                //ADDS SPACES AS PLAIN TEXT
                frag.appendChild(document.createTextNode(text.slice(pos, sent.charStart)));
            //FOR EACH SENTENCE CREATE SPAN ELEMENT
            const span = document.createElement("span");
            span.className = "sentence";
            span.textContent = sent.text;
            sentenceSpans.push(span);
            frag.appendChild(span);
            pos = sent.charEnd;
        }
        if (pos < text.length) 
            frag.appendChild(document.createTextNode(text.slice(pos)));
        displayDiv.innerHTML = "";  //KEEPS DISPLAY CLEAN
        displayDiv.appendChild(frag); //ADS THE FRAGMENT TO PAGE
    } else {
        // IN DESKTOP PATH
        // --- PERF: use a single innerHTML build for large texts instead of thousands of appendChilds ---
        const LARGE_TEXT_THRESHOLD = 20000;
        if (text.length > LARGE_TEXT_THRESHOLD) {
            let html = "";
            text.split(/(\s+)/).forEach(token => {
                if (/^\s+$/.test(token)) {
                    html += token.replace(/&/g, "&amp;").replace(/</g, "&lt;");
                } else if (token.length > 0) {
                    const safe = token.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
                    html += `<span class="word">${safe}</span>`;
                }
            });
            displayDiv.innerHTML = html;
            wordSpans = Array.from(displayDiv.querySelectorAll(".word"));
        } else {
            const frag = document.createDocumentFragment();
            //SPLITS EACH TEXT BY WORD — every non-whitespace token gets a span, including symbols like - → ε
            text.split(/(\s+)/).forEach(token => {
                if (/^\s+$/.test(token)) { // IF SPACES NO SPAN TAG NEEDED
                    frag.appendChild(document.createTextNode(token));
                } else if (token.length > 0) {
                    const span = document.createElement("span");
                    span.className = "word";
                    span.textContent = token;
                    wordSpans.push(span); 
                    frag.appendChild(span);
                }
            });
            displayDiv.innerHTML = ""; 
            displayDiv.appendChild(frag);
        }
    }
}

// buildCharMap maps every character position to its span index
function buildCharMap(text) {
    charToSpanMap = new Uint32Array(text.length + 1).fill(0xFFFFFFFF);
    let idx = 0, pos = 0;
    for (const token of text.split(/(\s+)/)) {
        if (/^\s+$/.test(token)) {
            pos += token.length;
        } else if (token.length > 0) {
            for (let i = 0; i < token.length; i++) charToSpanMap[pos + i] = idx;
            pos += token.length; idx++;
        }
    }
}

// FIX BUG 2: marks all spans from lastHighlight+1 up to (but not including) newIdx as spoken
// this catches symbol spans that onboundary skips entirely
function markSpanRangeSpoken(fromIdx, toIdx) {
    for (let i = fromIdx; i < toIdx && i < wordSpans.length; i++) {
        if (wordSpans[i]) {
            wordSpans[i].classList.remove("highlight");
            wordSpans[i].classList.add("spoken");
        }
    }
}

//  MOBILE: SENTENCE HIGHLIGHT

function setSentenceHighlight(idx) {
    if (idx === currentSentence) return; //EXIT IF HIGHLIGHTED THE SAME TEXT
    if (currentSentence >= 0 && sentenceSpans[currentSentence]) {
        sentenceSpans[currentSentence].classList.remove("sentence-highlight");
        sentenceSpans[currentSentence].classList.add("sentence-spoken");
    }
    currentSentence = idx; //UPDATES THE TRACKER TO CURRENT SENTENCE
    if (idx >= 0 && sentenceSpans[idx]) {
        sentenceSpans[idx].classList.remove("sentence-spoken");
        sentenceSpans[idx].classList.add("sentence-highlight");
        scrollSpanIntoView(sentenceSpans[idx]);
        if (sentences[idx]) {
            lastCharIndex = sentences[idx].charStart;
            progressBar.style.width = (sentences[idx].charStart / fullText.length * 100) + "%";
        }
    }
}

function markSentenceSpoken(idx) {
    if (sentenceSpans[idx]) {
        sentenceSpans[idx].classList.remove("sentence-highlight");
        sentenceSpans[idx].classList.add("sentence-spoken");
    }
    if (sentences[idx]) {
        //FILLS THE PROGRESS BAR    
        progressBar.style.width = (sentences[idx].charEnd / fullText.length * 100) + "%";
        lastCharIndex = sentences[idx].charEnd;
    }
}

//  MOBILE: UTTERANCE QUEUE
function buildQueue(fromSentIdx, resumeCharOffset) {
    sentenceQueue = [];
    queueIndex = fromSentIdx;

    for (let i = fromSentIdx; i < sentences.length; i++) {
        const sent = sentences[i];
        // For the first sentence in queue, trim text to start from resumeCharOffset if provided
        const sentText = (i === fromSentIdx && resumeCharOffset > 0)
            ? sent.text.slice(resumeCharOffset)
            : sent.text;
        const utt  = new SpeechSynthesisUtterance(sentText);
        utt.voice  = voices[voiceSelect.value] || null;
        utt.rate   = currentSpeed;
        utt.pitch  = 1;
        utt.volume = 1;
        if (utt.voice) utt.lang = utt.voice.lang;

        const sentIdx = i;
        // charBase is the absolute char position where this utterance's text starts
        const charBase = (i === fromSentIdx && resumeCharOffset > 0)
            ? sent.charStart + resumeCharOffset
            : sent.charStart;

        utt.onstart = () => {
            if (queueCancelled) return;
            isSpeaking = true; isPaused = false;
            queueIndex = sentIdx;
            setSentenceHighlight(sentIdx);
            smoothScroll();
            setButtonState("speaking");
        };

        utt.onboundary = (event) => {
            if (event.name !== "word" || queueCancelled) return;
            const absChar = charBase + event.charIndex;
            lastCharIndex = absChar;
            progressBar.style.width = (absChar / fullText.length * 100) + "%";
        };

        utt.onend = () => {
            if (queueCancelled) return;
            markSentenceSpoken(sentIdx);

            const nextIdx = sentIdx + 1;
            if (nextIdx < sentences.length) {
                speechSynthesis.speak(sentenceQueue[nextIdx - fromSentIdx]);
            } else {
                finishPlayback();
            }
        };

        utt.onerror = (e) => {
            if (e.error === "interrupted" || e.error === "canceled") return;
            if (queueCancelled) return;
            const nextIdx = sentIdx + 1;
            if (nextIdx < sentences.length) {
                speechSynthesis.speak(sentenceQueue[nextIdx - fromSentIdx]);
            } else {
                finishPlayback();
            }
        };

        sentenceQueue.push(utt);
    }
}

function startQueue(fromSentIdx, resumeCharOffset) {
    queueCancelled = false;
    buildQueue(fromSentIdx, resumeCharOffset || 0);
    if (sentenceQueue.length > 0) {
        speechSynthesis.speak(sentenceQueue[0]);
    }
}

function cancelQueue() {
    queueCancelled = true;
    speechSynthesis.cancel();
    sentenceQueue = [];
}

function finishPlayback() {
    isSpeaking = false; isPaused = false;
    stopScroll();
    progressBar.style.width = "100%";
    sentenceSpans.forEach(s => { s.classList.remove("sentence-highlight"); s.classList.add("sentence-spoken"); });
    currentSentence = -1;
    setButtonState("idle");
    setTimeout(() => {
        progressBar.style.width = "0%";
        clearHighlights();
        lastCharIndex = 0;
    }, 1500);
}

function highlightWordByChar(charIndex) {
    const text = hiddenInput.value;
    if (!charToSpanMap || charToSpanMap.length !== text.length + 1) buildCharMap(text);
    const c = Math.min(Math.max(charIndex, 0), text.length - 1);
    const idx = charToSpanMap[c];
    if (idx === 0xFFFFFFFF) return;

    // FIX BUG 2: mark every span between the previous highlight and this one as spoken
    // this catches symbol/punctuation spans that onboundary never fires for
    if (currentHighlight >= 0 && idx > currentHighlight + 1) {
        markSpanRangeSpoken(currentHighlight + 1, idx);
    }

    setWordHighlight(idx);
}

function setWordHighlight(idx) {
    if (idx === currentHighlight) return;
    if (currentHighlight >= 0 && wordSpans[currentHighlight]) {
        wordSpans[currentHighlight].classList.remove("highlight");
        wordSpans[currentHighlight].classList.add("spoken");
    }
    currentHighlight = idx;
    if (wordSpans[idx]) { wordSpans[idx].classList.add("highlight"); scrollSpanIntoView(wordSpans[idx]); }
}

//  SHARED HIGHLIGHT UTILITIES

function clearHighlights() {
    wordSpans.forEach(s => s.classList.remove("highlight", "spoken"));
    sentenceSpans.forEach(s => s.classList.remove("sentence-highlight", "sentence-spoken"));
    currentHighlight = -1; currentSentence = -1;
}

function markAllSpoken() {
    wordSpans.forEach(s => { s.classList.remove("highlight"); s.classList.add("spoken"); });
    sentenceSpans.forEach(s => { s.classList.remove("sentence-highlight"); s.classList.add("sentence-spoken"); });
    currentHighlight = -1; currentSentence = -1;
}

// FIX BUG 1: markSpokenUpTo now marks spans strictly BEFORE the current word
// so the word being spoken right now stays unlit, not faded
function markSpokenUpTo(charIndex) {
    if (IS_MOBILE) {
        sentences.forEach((sent, i) => {
            if (sent.charEnd <= charIndex && sentenceSpans[i])
                sentenceSpans[i].classList.add("sentence-spoken");
        });
    } else {
        if (!charToSpanMap) buildCharMap(hiddenInput.value);
        // find the span index AT charIndex — that span is the one about to be spoken, do NOT mark it
        const c = Math.min(Math.max(charIndex, 0), charToSpanMap.length - 2);
        let currentSpanIdx = charToSpanMap[c];
        // if charIndex lands on a space (0xFFFFFFFF), walk backwards to find the last spoken span
        if (currentSpanIdx === 0xFFFFFFFF) {
            let scan = c - 1;
            while (scan >= 0 && charToSpanMap[scan] === 0xFFFFFFFF) scan--;
            currentSpanIdx = scan >= 0 ? charToSpanMap[scan] + 1 : 0;
        }
        // mark everything strictly before currentSpanIdx as spoken
        for (let i = 0; i < currentSpanIdx && i < wordSpans.length; i++) {
            wordSpans[i].classList.add("spoken");
        }
    }
}

//  SMOOTH SCROLL

function scrollSpanIntoView(span) {
    const dr      = displayDiv.getBoundingClientRect();
    const sr      = span.getBoundingClientRect();
    const top     = sr.top    - dr.top + displayDiv.scrollTop;
    const bot     = sr.bottom - dr.top + displayDiv.scrollTop;
    // keep 120px breathing room above and 30% of visible height below
    // so the highlighted word always sits in the upper-mid area of the box
    const padTop  = 120;
    const padBot  = Math.round(displayDiv.clientHeight * 0.30);
    if (top < displayDiv.scrollTop + padTop)
        targetScrollTop = top - padTop;
    else if (bot > displayDiv.scrollTop + displayDiv.clientHeight - padBot)
        targetScrollTop = bot - displayDiv.clientHeight + padBot;
}

function smoothScroll() {
    const diff = targetScrollTop - displayDiv.scrollTop;
    // 0.12 easing — fast enough to keep up with speech, smooth enough to not jump
    if (Math.abs(diff) > 0.3) displayDiv.scrollTop += diff * 0.12;
    scrollFrame = requestAnimationFrame(smoothScroll);
}
function stopScroll() { if (scrollFrame) { cancelAnimationFrame(scrollFrame); scrollFrame = null; } }

//  CORE: startSpeechFrom
function startSpeechFrom(charIndex) {
    if (IS_MOBILE) {
        cancelQueue();
    } else {
        speechSynthesis.cancel();
    }
    stopScroll();

    const text = hiddenInput.value.trim();
    if (!text) return;
    fullText = text;

    charIndex = Math.max(0, Math.min(charIndex, text.length - 1));

    if (IS_MOBILE) {
        // MOBILE PATH
        if (!sentences.length || charIndex === 0) sentences = buildSentences(text);

        if (charIndex === 0) {
            renderWords(text);
            clearHighlights();
            targetScrollTop = 0; displayDiv.scrollTop = 0;
        } else {
            renderWords(text);
            clearHighlights();
            markSpokenUpTo(charIndex);
        }

        const fromSentIdx = sentenceIndexForChar(charIndex);
        // calculate how far into the sentence's text charIndex sits, so we resume mid-sentence
        const resumeCharOffset = Math.max(0, charIndex - sentences[fromSentIdx].charStart);
        isSpeaking = true; isPaused = false;
        setButtonState("speaking");
        smoothScroll();
        startQueue(fromSentIdx, resumeCharOffset);

    } else {
        // DESKTOP PATH
        const start = findNearestWordStart(text, charIndex);
        lastCharIndex = start;

        renderWords(text);
        buildCharMap(text);
        clearHighlights();

        if (start > 0) markSpokenUpTo(start);

        if (start === 0) {
            targetScrollTop = 0; displayDiv.scrollTop = 0;
        }

        const utterance   = new SpeechSynthesisUtterance(text.substring(start));
        utterance.voice   = voices[voiceSelect.value] || null;
        utterance.rate    = currentSpeed;
        utterance.pitch   = 1;
        utterance.volume  = 1;
        if (utterance.voice) utterance.lang = utterance.voice.lang;

        utterance.onboundary = (event) => {
            if (event.name !== "word") return;
            const absChar = start + event.charIndex;
            lastCharIndex = absChar;
            progressBar.style.width = (absChar / text.length * 100) + "%";
            highlightWordByChar(absChar);
        };

        utterance.onstart = () => {
            isSpeaking = true; isPaused = false;
            smoothScroll(); setButtonState("speaking");
        };

        utterance.onend = () => {
            if (!isSpeaking && !isPaused) return;
            isSpeaking = false; isPaused = false;
            stopScroll();
            progressBar.style.width = "100%"; markAllSpoken(); setButtonState("idle");
            setTimeout(() => { progressBar.style.width = "0%"; clearHighlights(); lastCharIndex = 0; }, 1500);
        };

        utterance.onerror = (e) => {
            if (e.error === "interrupted" || e.error === "canceled") return;
            isSpeaking = false; isPaused = false;
            stopScroll(); setButtonState("idle");
        };

        speechSynthesis.speak(utterance);
    }
}

function findNearestWordStart(text, idx) {
    while (idx > 0 && text[idx - 1] !== " " && text[idx - 1] !== "\n") idx--;
    while (idx < text.length && (text[idx] === " " || text[idx] === "\n")) idx++;
    return idx;
}

//  BUTTON STATE
function setButtonState(state) {
    if (state === "idle") {
        speakBtn.innerHTML   = "▶\u00A0 Listen"; 
        speakBtn.classList.remove("speaking", "paused");
        pauseBtn.innerHTML   = "⏸\u00A0 Pause";  
        pauseBtn.disabled = true; 
        pauseBtn.classList.remove("active");
        backwardBtn.disabled = true;  
        backwardBtn.classList.remove("active");
        forwardBtn.disabled  = true;  
        forwardBtn.classList.remove("active");
    } else if (state === "speaking") {
        speakBtn.innerHTML   = "⏹\u00A0 Stop";   
        speakBtn.classList.add("speaking"); 
        speakBtn.classList.remove("paused");
        pauseBtn.innerHTML   = "⏸\u00A0 Pause";  
        pauseBtn.disabled = false; 
        pauseBtn.classList.remove("active");
        backwardBtn.disabled = false; 
        backwardBtn.classList.add("active");
        forwardBtn.disabled  = false; 
        forwardBtn.classList.add("active");
    } else if (state === "paused") {
        speakBtn.innerHTML   = "⏹\u00A0 Stop";   speakBtn.classList.remove("speaking");
        pauseBtn.innerHTML   = "▶\u00A0 Resume"; pauseBtn.disabled = false; pauseBtn.classList.add("active");
        backwardBtn.disabled = false; backwardBtn.classList.add("active");
        forwardBtn.disabled  = false; forwardBtn.classList.add("active");
    }
}

//  LISTEN / STOP
speakBtn.addEventListener("click", () => {
    if (isSpeaking || isPaused) {
        isSpeaking = false; isPaused = false;
        if (IS_MOBILE) 
        cancelQueue(); 
        else speechSynthesis.cancel();
        stopScroll();
        progressBar.style.width = "0%"; clearHighlights(); lastCharIndex = 0;
        setButtonState("idle"); return;
    }
    if (!hiddenInput.value.trim()) 
    { alert("No text to speak!"); 
        return; }
    startSpeechFrom(0);
});

//  PAUSE / RESUME
pauseBtn.addEventListener("click", () => {
    if (isPaused) {
        if (IS_MOBILE) {
            isPaused = false; isSpeaking = true;
            setButtonState("speaking");
            smoothScroll();
            startQueue(Math.max(0, currentSentence));
        } else {
            speechSynthesis.resume(); isSpeaking = true; isPaused = false;
            smoothScroll();
            setButtonState("speaking");
        }
    } else if (isSpeaking) {
        if (IS_MOBILE) {
            cancelQueue();
            isSpeaking = false; isPaused = true;
            stopScroll(); 
            setButtonState("paused");
        } else {
            speechSynthesis.pause(); isSpeaking = false; isPaused = true;
            stopScroll(); 
            setButtonState("paused");
        }
    }
});

//  SEEK (forward / backward)

function skipWords(forward) {
    if (!isSpeaking && !isPaused) return;

    if (IS_MOBILE) {
        // find the next word boundary after lastCharIndex within the current or next sentence
        const text = hiddenInput.value.trim();
        let targetChar;

        if (forward) {
            // start scanning from one character past lastCharIndex to skip past current word
            let pos = lastCharIndex + 1;
            // skip remainder of current word
            while (pos < text.length && text[pos] !== " " && text[pos] !== "\n") pos++;
            // skip whitespace
            while (pos < text.length && (text[pos] === " " || text[pos] === "\n")) pos++;
            if (pos >= text.length) {
                cancelQueue();
                isSpeaking = false; isPaused = false; stopScroll();
                progressBar.style.width = "100%"; markAllSpoken(); setButtonState("idle");
                setTimeout(() => { progressBar.style.width = "0%"; clearHighlights(); lastCharIndex = 0; }, 1500);
                return;
            }
            targetChar = pos;
        } else {
            // skip backward one word
            let pos = lastCharIndex;
            // step back over any whitespace
            while (pos > 0 && (text[pos - 1] === " " || text[pos - 1] === "\n")) pos--;
            // step back over current word
            while (pos > 0 && text[pos - 1] !== " " && text[pos - 1] !== "\n") pos--;
            // if we're already at or very near the start of a word, go back one more word
            if (pos >= lastCharIndex - 1 && pos > 0) {
                while (pos > 0 && (text[pos - 1] === " " || text[pos - 1] === "\n")) pos--;
                while (pos > 0 && text[pos - 1] !== " " && text[pos - 1] !== "\n") pos--;
            }
            targetChar = Math.max(0, pos);
        }

        cancelQueue();
        stopScroll(); clearHighlights();
        markSpokenUpTo(targetChar);
        isSpeaking = true; isPaused = false;
        setButtonState("speaking");
        smoothScroll();
        const fromSentIdx = sentenceIndexForChar(targetChar);
        const resumeCharOffset = Math.max(0, targetChar - sentences[fromSentIdx].charStart);
        startQueue(fromSentIdx, resumeCharOffset);
        return;
    }

    // Desktop: skip by words
    const text   = hiddenInput.value.trim();
    const toSkip = Math.round((120 * currentSpeed / 60) * 10);
    let pos = lastCharIndex, skipped = 0, inWord = false;

    if (forward) {
        while (pos < text.length && skipped < toSkip) {
            const isW = text[pos] !== " " && text[pos] !== "\n" && text[pos] !== "\t";
            if (isW && !inWord) inWord = true;
            else if (!isW && inWord) { inWord = false; skipped++; }
            pos++;
        }
        while (pos < text.length && (text[pos] === " " || text[pos] === "\n")) pos++;
        if (pos >= text.length) {
            isSpeaking = false; isPaused = false; speechSynthesis.cancel(); stopScroll();
            progressBar.style.width = "100%"; markAllSpoken(); setButtonState("idle");
            setTimeout(() => { progressBar.style.width = "0%"; clearHighlights(); lastCharIndex = 0; }, 1500);
            return;
        }
    } else {
        while (pos > 0 && text[pos] !== " " && text[pos] !== "\n") pos--;
        while (pos > 0 && skipped < toSkip) {
            pos--;
            const isW = text[pos] !== " " && text[pos] !== "\n" && text[pos] !== "\t";
            if (isW && !inWord) inWord = true;
            else if (!isW && inWord) { inWord = false; skipped++; }
        }
        while (pos > 0 && text[pos - 1] !== " " && text[pos - 1] !== "\n") pos--;
        pos = Math.max(0, pos);
    }
    startSpeechFrom(pos);
}

forwardBtn .addEventListener("click", () => skipWords(true));
backwardBtn.addEventListener("click", () => skipWords(false));

//  TEXT INPUT
displayDiv.addEventListener("input", () => {
    hiddenInput.value = displayDiv.innerText;
    charToSpanMap = null; //since the text has changed, the old "map" of where words are located is now wrong. By setting it to null, we force the app to rebuild a new map when the user hits Play.
    lastRenderedText = ""; // --- PERF: force re-render since text changed ---
    updateReadingTime();
    if (!displayDiv.innerText.trim()) {
        if (isSpeaking || isPaused) {
            isSpeaking = false; isPaused = false;
            if (IS_MOBILE) cancelQueue(); 
            else speechSynthesis.cancel();
            stopScroll(); 
            progressBar.style.width = "0%"; 
            setButtonState("idle");
        }
        sentences = [];
        uploadText.textContent = "📄 Upload PDF or DOCX"; uploadText.style.color = "#9CA3AF";
        pdfInput.value = "";
        clearRow.style.display = "none";
    } else {
        clearRow.style.display = "flex";
    }
});

//  CLEAR BUTTON
clearBtn.addEventListener("click", () => {
    if (isSpeaking || isPaused) {
        isSpeaking = false; isPaused = false;
        if (IS_MOBILE) cancelQueue(); 
        else speechSynthesis.cancel();
        stopScroll();
        setButtonState("idle");
    }
    displayDiv.innerHTML = "";
    hiddenInput.value = "";
    charToSpanMap = null;
    lastRenderedText = "";
    lastCharIndex = 0;
    sentences = [];
    sentenceSpans = [];
    wordSpans = [];
    currentHighlight = -1; currentSentence = -1;
    progressBar.style.width = "0%";
    uploadText.textContent = "📄 Upload PDF or DOCX"; uploadText.style.color = "#9CA3AF";
    pdfInput.value = "";
    clearRow.style.display = "none";
    updateReadingTime();
});

//  READING TIME
function updateReadingTime() {
    const text  = hiddenInput.value.trim();
    const chars = text.length;
    if (!chars) { 
    readingTime.textContent = "Estimated reading time: 0 min"; return; }

    const charsPerSec = 15 * currentSpeed;
    const totalSecs   = chars / charsPerSec;

    if (totalSecs < 60) {
        readingTime.textContent = "Estimated reading time: " + Math.ceil(totalSecs) + " sec";
        return;
    }
    const m = Math.floor(totalSecs / 60);
    const s = Math.ceil(totalSecs % 60);
    readingTime.textContent = "Estimated reading time: " + m + " min" + (s > 0 ? " " + s + " sec" : "");
}

// FILE UPLOAD
pdfInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const name = file.name.toLowerCase();
    if (!name.endsWith(".pdf") && !name.endsWith(".docx")) {
        uploadText.textContent = "❌ Please upload a PDF or DOCX file"; 
        uploadText.style.color = "red"; 
        return;
    }
    uploadText.textContent = "⏳ Uploading..."; 
    uploadText.style.color = "white";
    const fd = new FormData(); 
    fd.append("pdfFile", file);
    try {
        const res  = await fetch("/upload-pdf", { method: "POST", body: fd });
        const data = await res.json();
        if (!res.ok || data.error) 
            throw new Error(data.error || "Server error " + res.status);
        if (!data.text?.trim()) 
            throw new Error("No text found in file");
        hiddenInput.value = data.text; // Saves the full text to a hidden box for later.
        lastRenderedText = ""; // --- PERF: force fresh render for new file ---
        sentences = buildSentences(data.text); // Chops it into sentences (for mobile highlighting).
        renderWords(data.text);// Creates the <span> tags so you can see the text on the screen.
        if (!IS_MOBILE) 
        buildCharMap(data.text);
        uploadText.textContent = `✅ File Loaded! (${data.text.length} characters)`;
        uploadText.style.color = "#4CAF50";
        updateReadingTime();
        clearRow.style.display = "flex";
    } catch (err) {
        uploadText.textContent = "❌ " + err.message; uploadText.style.color = "#ff2963";
        alert("Error: " + err.message);
    }
});

//  CLEANUP( or else it keeps speaking when tab closed)
window.addEventListener("beforeunload", () => {
    if (IS_MOBILE) cancelQueue(); 
    else speechSynthesis.cancel();
    stopScroll();
});

//  DOWNLOAD MP3
downloadBtn.addEventListener("click", async () => {
    const text = hiddenInput.value.trim();
    if (!text) { 
    showDownloadStatus("error", "No text to download."); return; }
    const lang = downloadLangSelect.value;
    downloadBtn.disabled = true;
    downloadBtn.innerHTML = '<svg class="spin" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Generating...';
    showDownloadStatus("info", "Generating audio, please wait…");
    try {
        const res = await fetch("/download-tts", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text, lang })
        });
        if (!res.ok) { const err = await res.json().catch(() => ({ error: "Server error" })); throw new Error(err.error || "Server error " + res.status); }
        const blob = await res.blob();
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement("a");
        a.href = url; //DOWNLOADS WITHOUT PERMISSION
        a.download = "tts-audio.mp3";
        document.body.appendChild(a); 
        a.click(); 
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showDownloadStatus("success", "Download started!");
    } catch (err) {
        showDownloadStatus("error", "Failed: " + err.message);
    } finally {
        downloadBtn.disabled = false;
        downloadBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Download MP3';
    }
});

function showDownloadStatus(type, message) {
    downloadStatus.textContent = message; downloadStatus.className = "download-status " + type;
    if (type !== "error") setTimeout(() => { downloadStatus.textContent = ""; downloadStatus.className = "download-status"; }, 4000);
}