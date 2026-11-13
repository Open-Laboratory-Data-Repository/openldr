// The app's own page: starting, stopping and the error screen. It holds no words of its own. Main
// sends a PageState in the person's language, and this shows it.
'use strict';

(function () {
  var api = window.openldrDesktopPage;
  var title = document.getElementById('title');
  var message = document.getElementById('message');
  var note = document.getElementById('note');
  var logs = document.getElementById('logs');
  var spinner = document.getElementById('spinner');
  var retry = document.getElementById('retry');

  function text(el, value) {
    el.textContent = value || '';
    el.hidden = !value;
  }

  function render(state) {
    document.title = state.title;
    text(title, state.title);
    text(message, state.message);
    text(note, state.note);
    logs.replaceChildren();
    (state.logs || []).forEach(function (path) {
      var item = document.createElement('li');
      item.textContent = path;
      logs.appendChild(item);
    });
    logs.hidden = !state.logs || state.logs.length === 0;
    text(retry, state.retryLabel);
    retry.disabled = false;
    // Starting and stopping show a spinner; the error screen shows a button instead.
    spinner.hidden = Boolean(state.retryLabel);
  }

  if (!api) return;
  api.onScreen(render);
  retry.addEventListener('click', function () {
    retry.disabled = true;
    api.retry();
  });
})();
