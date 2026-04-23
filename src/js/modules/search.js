function normalizeText(str) {
  return (str || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function ensureSearchBox(col, placeholder) {
  let box = col.querySelector(".col-search");
  if (!box) {
    box = document.createElement("div");
    box.className = "col-search";
    box.innerHTML = `
      <input class="search-input" type="text" placeholder="${placeholder}">
      <div class="search-count">0 rezultate</div>
    `;
    const head = col.querySelector(".bcol-head");
    if (head && head.nextSibling) {
      col.insertBefore(box, head.nextSibling);
    } else {
      col.appendChild(box);
    }
  }
  return box;
}

export function addBooksSearch(col) {
  const box = ensureSearchBox(col, "Caută carte...");
  const input = box.querySelector(".search-input");
  const count = box.querySelector(".search-count");

  const applyFilter = () => {
    const q = normalizeText(input.value.trim());
    const rows = [...col.querySelectorAll(".brow")];
    let visible = 0;

    rows.forEach((row) => {
      const text = normalizeText(row.querySelector(".brow-name")?.textContent || row.textContent);
      const show = !q || text.includes(q);
      row.style.display = show ? "" : "none";
      if (show) visible += 1;
    });

    count.textContent = `${visible} rezultate`;
  };

  input.oninput = applyFilter;
  applyFilter();
}

export function addArticlesSearch(col) {
  const box = ensureSearchBox(col, "Caută articol...");
  const input = box.querySelector(".search-input");
  const count = box.querySelector(".search-count");

  const applyFilter = () => {
    const q = normalizeText(input.value.trim());
    const rows = [...col.querySelectorAll(".art-row")];
    let visible = 0;

    rows.forEach((row) => {
      const text = normalizeText(row.querySelector(".art-title")?.textContent || row.textContent);
      const show = !q || text.includes(q);
      row.style.display = show ? "" : "none";
      if (show) visible += 1;
    });

    count.textContent = `${visible} rezultate`;
  };

  input.oninput = applyFilter;
  applyFilter();
}
