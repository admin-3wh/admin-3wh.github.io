document.addEventListener('DOMContentLoaded', () => {
  const predictBtn = document.getElementById('predict-btn');
  const clearBtn = document.getElementById('clear-btn');
  const output = document.getElementById('output');
  const textarea = document.getElementById('ticket-text');

  predictBtn.addEventListener('click', async () => {
    const ticketText = textarea.value;
    const modelChoice = document.getElementById('model-select').value;
    console.log("Sending model_choice:", modelChoice);
    gtag('event', 'predict_click', {
      'event_category': 'triager',
      'event_label': modelChoice,
    });

    output.style.display = 'block';
    output.innerHTML = 'Loading...';

    try {
      const response = await fetch('https://triager-backend.onrender.com/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket_text: ticketText, model_choice: modelChoice })
      });

      const result = await response.json();

      if (!response.ok) {
        output.innerHTML = result.error || 'Error from backend';
        clearBtn.style.display = 'inline-block';
        return;
      }

      output.innerHTML = `
        <strong>Category:</strong> ${result.category} (${(result.category_confidence * 100).toFixed(2)}% confidence)<br>
        <strong>Priority:</strong> ${result.priority} (${(result.priority_confidence * 100).toFixed(2)}% confidence)<br>
        <em>Model used:</em> ${result.model_used}
      `;
      clearBtn.style.display = 'inline-block';
    } catch (error) {
      output.innerHTML = 'Failed to connect to backend.';
      clearBtn.style.display = 'inline-block';
    }
  });

  clearBtn.addEventListener('click', () => {
    textarea.value = '';
    output.innerHTML = '';
    output.style.display = 'none';
    clearBtn.style.display = 'none';
  });
});
