const toggle = document.getElementById('theme-toggle');
const hamburger = document.getElementById('hamburger');
const navLinks = document.querySelector('.nav-links');

// Load saved theme
if (localStorage.getItem('theme') === 'dark') {
  document.body.classList.add('dark');
  document.documentElement.classList.add('dark');
  toggle.textContent = 'Light';
} else {
  toggle.textContent = 'Dark';
}

// Toggle theme
toggle.addEventListener('click', () => {
  document.body.classList.toggle('dark');
  document.documentElement.classList.toggle('dark');
  const isDark = document.body.classList.contains('dark');
  toggle.textContent = isDark ? 'Light' : 'Dark';
  localStorage.setItem('theme', isDark ? 'dark' : 'light');
});

// Hamburger toggle
hamburger.addEventListener('click', () => {
  navLinks.classList.toggle('active');
  hamburger.classList.toggle('active');
});

// Auto-close nav on link click
document.querySelectorAll('.nav-links a').forEach(link => {
  link.addEventListener('click', () => {
    navLinks.classList.remove('active');
    hamburger.classList.remove('active');
  });
});

// Close menu when Close button is clicked
const navClose = document.getElementById('nav-close');
if (navClose) {
  navClose.addEventListener('click', () => {
    navLinks.classList.remove('active');
    hamburger.classList.remove('active');
  });
}
