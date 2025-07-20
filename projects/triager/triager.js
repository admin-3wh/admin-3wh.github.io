document.getElementById('predict-btn').addEventListener('click', async () => {
  const text = document.getElementById('ticket-text').value.trim();
  const model = document.getElementById('model-choice').value;
  const resultDiv = document.getElementById('result');

  if (!text) {
    alert("Please enter ticket text.");
    return;
  }

  resultDiv.style.display = 'block';
  resultDiv.textContent = 'Loading...';

  try {
    const response = await fetch('https://triager-backend.onrender.com/predict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket_text: text, model_choice: model })
    });

    if (!response.ok) {
      throw new Error('API request failed');
    }

    const data = await response.json();
    resultDiv.innerHTML = `
      <strong>Prediction:</strong><br>
      Category: ${data.category} (${(data.category_confidence * 100).toFixed(1)}% confident)<br>
      Priority: ${data.priority} (${(data.priority_confidence * 100).toFixed(1)}% confident)<br>
      Model Used: ${data.model_used}
    `;
  } catch (err) {
    console.error(err);
    resultDiv.textContent = 'An error occurred. Please try again later.';
  }
});
