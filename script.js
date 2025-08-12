// Syntax highlight with each character wrapped for animation
function syntaxHighlight(json) {
  json = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return json.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, match => {
    let cls = "text-cyan-400";
    if (/^"/.test(match)) {
      cls = /:$/.test(match) ? "text-fuchsia-400" : "text-yellow-300";
    } else if (/true|false/.test(match)) {
      cls = "text-orange-400";
    } else if (/null/.test(match)) {
      cls = "text-gray-400";
    } else {
      cls = "text-sky-300";
    }
    // Wrap each character in a span for GSAP animation
    return `<span class="${cls}">` + 
      [...match].map(c => `<span class="char">${c}</span>`).join('') + 
      `</span>`;
  });
}

const inputArea = document.getElementById('json-input');
const outputArea = document.getElementById('json-output');
const formatBtn = document.getElementById('format-btn');
const copyBtn = document.getElementById('copy-btn');
const clearBtn = document.getElementById('clear-btn');
const errorMsg = document.getElementById('error-message');

function showError(message) {
  errorMsg.textContent = message;
  gsap.killTweensOf(errorMsg);
  errorMsg.style.pointerEvents = 'auto';
  gsap.fromTo(errorMsg, 
    { y: 20, opacity: 0 }, 
    { y: 0, opacity: 1, duration: 0.4, ease: "power2.out",
      onComplete() {
        setTimeout(() => {
          gsap.to(errorMsg, {opacity: 0, duration: 0.5, onComplete() {
            errorMsg.style.pointerEvents = 'none';
          }});
        }, 1500);
      }
    });
}

function animateTyping() {
  const chars = outputArea.querySelectorAll('.char');
  gsap.fromTo(chars, 
    {opacity: 0, y: 5}, 
    {
      opacity: 1, y: 0, stagger: 0.00125, ease: "power1.out", duration: 0.25
    });
}

formatBtn.addEventListener('click', () => {
  copyBtn.disabled = true;  // disable copy while formatting
  try {
    const obj = JSON.parse(inputArea.value);
    const formatted = JSON.stringify(obj, null, 2);
    outputArea.innerHTML = syntaxHighlight(formatted);

    // Animate typing of highlighted JSON characters
    animateTyping();

    copyBtn.disabled = false;
    // Animate input area briefly to confirm formatting
    gsap.fromTo(inputArea, 
      {backgroundColor: '#164e63'}, 
      {backgroundColor: '#0f172a', duration: 0.5, yoyo: true, repeat: 1});
  } catch (err) {
    outputArea.textContent = '';
    copyBtn.disabled = true;
    showError('Invalid JSON: ' + err.message);
  }
});

copyBtn.addEventListener('click', () => {
  if (!outputArea.innerText.trim()) return;
  navigator.clipboard.writeText(outputArea.innerText).then(() => {
    copyBtn.textContent = 'Copied!';
    gsap.to(copyBtn, {
      backgroundColor: "#14b8a6",
      color: "#0f172a",
      duration: 0.3,
    });
    setTimeout(() => {
      copyBtn.textContent = 'Copy Output';
      gsap.to(copyBtn, {
        backgroundColor: "transparent",
        color: "#14b8a6",
        duration: 0.3,
      });
    }, 1500);
  });
});

clearBtn.addEventListener('click', () => {
  inputArea.value = '';
  outputArea.textContent = '';
  copyBtn.disabled = true;
  gsap.fromTo(inputArea, 
      {backgroundColor: '#991b1b'}, 
      {backgroundColor: '#0f172a', duration: 0.6});
  inputArea.focus();
});

inputArea.addEventListener('input', () => {
  if (!inputArea.value.trim()) {
    outputArea.textContent = '';
    copyBtn.disabled = true;
  }
  
  // Animate typing effect on input while typing
  gsap.fromTo(inputArea, 
    {backgroundColor: '#0f172a'}, 
    {backgroundColor: '#164e63', duration: 0.3, yoyo: true, repeat: 1});
});
