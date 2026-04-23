export function showProgress(colId, label) {
  const col = document.getElementById(colId);
  if (!col) return;

  hideProgress(colId);

  const wrap = document.createElement("div");
  wrap.className = "progress-wrap";
  wrap.dataset.progress = "true";
  wrap.innerHTML = `<span class="progress-label">${label}</span><div class="progress-bar"></div>`;

  const head = col.querySelector(".bcol-head");
  if (head && head.nextSibling) {
    col.insertBefore(wrap, head.nextSibling);
  } else {
    col.appendChild(wrap);
  }
}

export function hideProgress(colId) {
  const col = document.getElementById(colId);
  const existing = col?.querySelector(".progress-wrap[data-progress='true']");
  if (existing) existing.remove();
}
