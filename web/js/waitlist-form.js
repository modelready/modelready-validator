const waitlistSection = document.getElementById('waitlist-section');
const waitlistForm = document.getElementById('waitlist-form');
const waitlistConfirmation = document.getElementById('waitlist-confirmation');
const intentSection = document.getElementById('intent-section');
const intentAmountInput = document.getElementById('intent-amount');
const intentButton = document.getElementById('intent-button');
const intentConfirmation = document.getElementById('intent-confirmation');

let lastSubmittedEmail = null;

// Revealed after the first file report (success or per-file error) renders,
// so the offer appears regardless of pass/fail outcome.
document.addEventListener(
  'validator:report-rendered',
  () => {
    waitlistSection.hidden = false;
  },
  { once: true },
);

function showMessage(element, text, { isError = false } = {}) {
  element.textContent = text;
  element.classList.toggle('confirmation--error', isError);
  element.hidden = false;
}

async function submitWaitlist(payload) {
  const response = await fetch('/api/waitlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || `Request failed (${response.status})`);
  }
  return body;
}

waitlistForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(waitlistForm);
  const email = String(formData.get('email') || '').trim();
  const marketplace = String(formData.get('marketplace') || '') || null;
  const batchSize = String(formData.get('batchSize') || '').trim() || null;

  try {
    await submitWaitlist({ email, marketplace, batchSize });
    lastSubmittedEmail = email;
    showMessage(waitlistConfirmation, "You're on the list — we'll email you.");
    intentSection.hidden = false;
  } catch (err) {
    showMessage(waitlistConfirmation, err.message || 'Something went wrong — please try again.', {
      isError: true,
    });
  }
});

intentButton.addEventListener('click', async () => {
  if (!lastSubmittedEmail) {
    showMessage(intentConfirmation, 'Join the waitlist above first with your email.', { isError: true });
    return;
  }

  const amount = Number(intentAmountInput.value);
  if (!amount || amount <= 0) {
    showMessage(intentConfirmation, "Enter an amount you'd pay.", { isError: true });
    return;
  }

  try {
    await submitWaitlist({
      email: lastSubmittedEmail,
      prepaymentStatus: 'intent-expressed',
      statedAmount: amount,
    });
    showMessage(intentConfirmation, `Got it — you said you'd pay $${amount} now. We'll be in touch to arrange it.`);
  } catch (err) {
    showMessage(intentConfirmation, err.message || 'Something went wrong — please try again.', {
      isError: true,
    });
  }
});
