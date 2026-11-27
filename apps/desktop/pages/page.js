// The app's own page: starting, stopping, the error screen, and the screens of connect mode (the
// mode choice, the server address, the certificate question). It holds no words of its own. Main
// sends a PageState in the person's language, and this shows whatever parts are present.
'use strict';

(function () {
  var api = window.openldrDesktopPage;
  var title = document.getElementById('title');
  var message = document.getElementById('message');
  var note = document.getElementById('note');
  var logs = document.getElementById('logs');
  var spinner = document.getElementById('spinner');
  var retry = document.getElementById('retry');
  var detail = document.getElementById('detail');
  var field = document.getElementById('field');
  var fieldLabel = document.getElementById('field-label');
  var fieldInput = document.getElementById('field-input');
  var problem = document.getElementById('problem');
  var actions = document.getElementById('actions');
  /** The id of the primary action on screen. Enter in the input presses it. */
  var primary = null;

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
    text(detail, state.detail);
    text(problem, state.problem);
    field.hidden = !state.input;
    if (state.input) {
      fieldLabel.textContent = state.input.label;
      fieldInput.type = state.input.secret ? 'password' : 'text';
      fieldInput.placeholder = state.input.placeholder || '';
      fieldInput.value = state.input.value || '';
      fieldInput.disabled = false;
    }
    primary = null;
    actions.replaceChildren();
    (state.actions || []).forEach(function (action) {
      var button = document.createElement('button');
      button.type = 'button';
      button.textContent = action.label;
      button.dataset.action = action.id;
      if (action.primary) {
        button.className = 'primary';
        primary = action.id;
      }
      button.addEventListener('click', function () {
        act(action.id);
      });
      actions.appendChild(button);
    });
    actions.hidden = !state.actions || state.actions.length === 0;
    // Starting and stopping show a spinner. A screen with a button or a question shows none.
    spinner.hidden = Boolean(state.retryLabel) || !actions.hidden || !field.hidden;
    if (state.input) fieldInput.focus();
  }

  /** Sends a pressed button to main, with what the input holds. Buttons stay off until the next screen. */
  function act(id) {
    Array.prototype.forEach.call(actions.querySelectorAll('button'), function (b) {
      b.disabled = true;
    });
    fieldInput.disabled = true;
    api.act(id, field.hidden ? undefined : fieldInput.value);
  }

  if (!api) return;
  api.onScreen(render);
  retry.addEventListener('click', function () {
    retry.disabled = true;
    api.retry();
  });
  fieldInput.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' && primary !== null && !fieldInput.disabled) act(primary);
  });
})();
