document.addEventListener('DOMContentLoaded', () => {
  const predictBtn = document.getElementById('predict-btn');
  const output = document.getElementById('output');

  predictBtn.addEventListener('click', async () => {
    const ticketText = document.getElementById('ticket-text').value;
    const modelChoice = document.getElementById('model-select').value;

    output.style.display = 'block';
    output.innerHTML = 'Loading...';

    try {
      const response = await fetch('https://triager-backend.onrender.com/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket_text: ticketText, model_choice: modelChoice })
      });

      if (!response.ok) {
        output.innerHTML = 'Error from backend';
        return;
      }

      const result = await response.json();
      output.innerHTML = `
        <strong>Category:</strong> ${result.category} (${result.category_confidence * 100}% confidence)<br>
        <strong>Priority:</strong> ${result.priority} (${result.priority_confidence * 100}% confidence)<br>
        <em>Model used:</em> ${result.model_used}
      `;
    } catch (error) {
      output.innerHTML = 'Failed to connect to backend.';
    }
  });
});
