(function () {
  const grid = document.getElementById("catalog-grid");
  const searchInput = document.getElementById("search-input");
  const chips = document.querySelectorAll(".chip");

  let entries = [];
  let activeKind = "all";
  let query = "";

  function linkFor(item) {
    if (item.kind === "subject") return `subject.html?id=${item.id}`;
    if (item.fileUrl && item.fileUrl.endsWith(".html")) return item.fileUrl;
    return `view.html?id=${item.id}`;
  }

  function priceLabel(item) {
    return `$${(item.priceCents / 100).toFixed(2)}`;
  }

  async function buyEntry(id) {
    const res = await fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entryId: id })
    });
    const data = await res.json();
    if (data.url) {
      window.location.href = data.url;
    } else {
      alert(data.error || "Could not start checkout.");
    }
  }

  window.buyEntry = buyEntry;

  function render() {
    // Lessons that belong to a subject are reached through that subject's
    // tree page, not listed loose in the top-level catalog.
    const topLevel = entries.filter((item) => !item.parentId);

    const filtered = topLevel.filter((item) => {
      const matchesKind =
        activeKind === "all" ||
        item.kind === activeKind ||
        (activeKind === "guide" && item.kind === "subject");
      const matchesQuery =
        query.trim() === "" ||
        item.title.toLowerCase().includes(query) ||
        item.summary.toLowerCase().includes(query);
      return matchesKind && matchesQuery;
    });

    if (filtered.length === 0) {
      grid.innerHTML = `<div class="empty-state">Nothing matches that yet. Try a different search term or filter.</div>`;
      return;
    }

    grid.innerHTML = filtered
      .map((item) => {
        const titleHtml = item.premium
          ? `${item.title}`
          : `<a href="${linkFor(item)}">${item.title}</a>`;

        const actionHtml = item.premium
          ? `<button class="chip" style="margin-top:10px;" onclick="buyEntry('${item.id}')">Buy for ${priceLabel(item)}</button>`
          : "";

        const kindLabel = item.kind === "subject" ? "series" : item.kind;
        const lessonCount =
          item.kind === "subject"
            ? entries.filter((e) => e.parentId === item.id).length
            : 0;

        return `
        <article class="spec-card">
          <span class="spec-id">${item.id}</span>
          <h3>${titleHtml}</h3>
          <p>${item.summary}</p>
          <div class="spec-meta">
            <span class="tag-kind ${item.kind}">${kindLabel}</span>
            ${lessonCount ? `<span class="tag-kind">${lessonCount} lessons</span>` : ""}
            ${item.premium ? '<span class="tag-kind" style="color:var(--copper-bright);">paid</span>' : ""}
          </div>
          ${actionHtml}
        </article>`;
      })
      .join("");
  }

  chips.forEach((chip) => {
    chip.addEventListener("click", () => {
      chips.forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      activeKind = chip.dataset.kind;
      render();
    });
  });

  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      query = e.target.value.toLowerCase();
      render();
    });
  }

  fetch("/api/entries")
    .then((res) => res.json())
    .then((data) => {
      entries = data;
      render();
    })
    .catch(() => {
      grid.innerHTML = `<div class="empty-state">Couldn't load the catalog. Is the server running?</div>`;
    });
})();
