/* The MQ Studio website's theme, after Vane.
 *
 * Every page works without this script. It adds what only a script can:
 * pointing the download button at the reader's own build, choosing a package
 * on the download cards, closing the announcement, finding a page by its
 * title, copying code, links to headings, and marking the section being read.
 * Light and dark live in theme-init.html, which has to run before the first
 * paint. */
(function () {
  "use strict";

  var root = document.documentElement;
  var strings = document.body.dataset;
  var mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

  // The drawer of a narrow screen opens without a script; this closes it.
  var drawer = document.getElementById("nav-toggle");
  var sidebar = document.getElementById("sidebar");
  if (drawer && sidebar) {
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && drawer.checked) drawer.checked = false;
    });
    sidebar.addEventListener("click", function (event) {
      if (event.target.closest("a")) drawer.checked = false;
    });
    window.matchMedia("(min-width: 960px)").addEventListener("change", function (event) {
      if (event.matches) drawer.checked = false;
    });
  }

  // The announcement, closed for good until a new one replaces it.
  var bar = document.querySelector(".announcement[data-announcement]");
  var closer = bar && bar.querySelector("[data-announcement-close]");
  if (closer) {
    closer.hidden = false;
    closer.addEventListener("click", function () {
      try { localStorage.setItem("mq-studio:announcement-dismissed", bar.getAttribute("data-announcement")); } catch (e) {}
      root.classList.add("no-announcement");
    });
  }

  // The download button under the headline, pointed at the reader's own
  // build. navigator.platform says MacIntel on Apple silicon too, so a Mac
  // starts on Apple silicon; Chromium corrects it below, and the menu covers
  // the browsers that will not say.
  var main = document.querySelector("[data-menu-primary]");
  if (main) {
    var ua = navigator.userAgent;
    var pick = null;
    if (/Mac/i.test(ua) && !/iPhone|iPad/i.test(ua)) pick = "mac-arm";
    else if (/Win/i.test(ua)) pick = "windows";
    else if (/Linux|X11/i.test(ua) && !/Android/i.test(ua)) pick = "linux";
    var label = main.querySelector("[data-menu-label]");
    var icons = main.querySelectorAll("[data-menu-icon]");
    var point = function (key) {
      var url = main.getAttribute("data-" + key);
      if (!url) return;
      main.setAttribute("href", url);
      if (label) label.textContent = main.getAttribute("data-" + key + "-label");
      var icon = key === "windows" ? "windows" : key === "linux" ? "linux" : "apple";
      icons.forEach(function (one) { one.hidden = one.getAttribute("data-menu-icon") !== icon; });
    };
    if (pick) point(pick);
    var data = navigator.userAgentData;
    if (pick === "mac-arm" && data && data.getHighEntropyValues) {
      data.getHighEntropyValues(["architecture"]).then(function (values) {
        if (values.architecture === "x86") point("mac-intel");
      }, function () {});
    }
  }

  // The list of every package beside it: a click, the keyboard, and on a
  // screen that really hovers, the pointer.
  document.querySelectorAll("[data-menu]").forEach(function (menu) {
    var trigger = menu.querySelector("[data-menu-trigger]");
    var list = menu.querySelector("[data-menu-list]");
    if (!trigger || !list) return;
    var items = function () { return Array.prototype.slice.call(list.querySelectorAll("[role='menuitem']")); };
    var open = function (yes) {
      list.hidden = !yes;
      trigger.setAttribute("aria-expanded", yes ? "true" : "false");
    };
    // A pointer opens the menu on its way to the button, so the click that
    // follows must not close it again.
    var hovered = false;
    trigger.addEventListener("click", function (event) {
      if (hovered && !list.hidden) {
        hovered = false;
        return;
      }
      var opening = list.hidden;
      open(opening);
      if (opening && event.detail === 0) { var first = items()[0]; if (first) first.focus(); }
    });
    if (window.matchMedia("(hover: hover)").matches) {
      var timer = 0;
      menu.addEventListener("mouseenter", function () {
        clearTimeout(timer);
        hovered = list.hidden;
        open(true);
      });
      // A grace period, so the pointer can clip a corner on its way down.
      menu.addEventListener("mouseleave", function () {
        clearTimeout(timer);
        hovered = false;
        timer = setTimeout(function () { open(false); }, 160);
      });
    }
    menu.addEventListener("keydown", function (event) {
      var all = items();
      var at = all.indexOf(document.activeElement);
      if (event.key === "Escape") {
        open(false);
        trigger.focus();
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        open(true);
        var step = event.key === "ArrowDown" ? 1 : -1;
        var next = all[(at + step + all.length) % all.length] || all[0];
        if (next) next.focus();
      }
    });
    menu.addEventListener("focusout", function (event) {
      if (!menu.contains(event.relatedTarget)) open(false);
    });
    document.addEventListener("click", function (event) {
      if (!menu.contains(event.target)) open(false);
    });
  });

  // A card per platform: the choices pick a package, and the button, the
  // file name and the mirror follow. The server drew the default package.
  document.querySelectorAll("[data-picker]").forEach(function (card) {
    var variants = {};
    card.querySelectorAll(".platform-variants li").forEach(function (li) { variants[li.getAttribute("data-key")] = li; });
    var segments = card.querySelectorAll("[data-segment]");
    var selection = [];
    segments.forEach(function (segment, i) {
      var checked = segment.querySelector("[aria-checked='true']");
      selection[i] = checked ? checked.value : "";
    });
    var link = card.querySelector("[data-picker-link]");
    var file = card.querySelector("[data-picker-file]");
    var size = card.querySelector("[data-picker-size]");
    var alt = card.querySelector("[data-picker-alt]");
    var apply = function () {
      var match = variants[selection.join(":")];
      if (!match || !link) return;
      link.href = match.getAttribute("data-url");
      if (file) {
        file.textContent = match.getAttribute("data-name");
        file.title = match.getAttribute("data-name");
      }
      if (size) size.textContent = match.getAttribute("data-size");
      if (alt) {
        var mirror = match.getAttribute("data-alternate");
        alt.hidden = !mirror;
        if (mirror) alt.href = mirror;
      }
    };
    segments.forEach(function (segment, i) {
      var options = Array.prototype.slice.call(segment.querySelectorAll("[role='radio']"));
      var choose = function (option, focus) {
        selection[i] = option.value;
        options.forEach(function (other) {
          var on = other === option;
          other.setAttribute("aria-checked", on ? "true" : "false");
          other.tabIndex = on ? 0 : -1;
        });
        if (focus) option.focus();
        apply();
      };
      options.forEach(function (option, j) {
        option.addEventListener("click", function () { choose(option); });
        option.addEventListener("keydown", function (event) {
          var last = options.length - 1;
          var to = null;
          if (event.key === "ArrowRight" || event.key === "ArrowDown") to = j === last ? 0 : j + 1;
          else if (event.key === "ArrowLeft" || event.key === "ArrowUp") to = j === 0 ? last : j - 1;
          if (to === null) return;
          event.preventDefault();
          choose(options[to], true);
        });
      });
    });
  });

  // A long tree opens scrolled to the page being read.
  var current = document.querySelector(".tree a[aria-current='page']");
  if (current && sidebar && sidebar.scrollHeight > sidebar.clientHeight) {
    var top = current.getBoundingClientRect().top - sidebar.getBoundingClientRect().top;
    if (top > sidebar.clientHeight * 0.6) sidebar.scrollTop = top - sidebar.clientHeight / 3;
  }

  // Links to headings.
  document.querySelectorAll(".prose h2[id], .prose h3[id], .prose h4[id]").forEach(function (heading) {
    var link = document.createElement("a");
    link.className = "anchor";
    link.href = "#" + heading.id;
    link.setAttribute("aria-label", strings.anchor || "Link to this section");
    link.textContent = "#";
    heading.insertBefore(link, heading.firstChild);
  });

  // Copying code: a button that copies the text it is given, and says so.
  var ICON = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
  var COPY = ICON + '<rect class="copy-icon" x="9" y="9" width="11" height="11" rx="2"/><path class="copy-icon" d="M5 15V6a2 2 0 0 1 2-2h9"/><path class="check" d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
  var copyButton = function (text) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "code-copy";
    button.title = strings.copy || "Copy";
    button.setAttribute("aria-label", strings.copy || "Copy");
    button.innerHTML = COPY;
    var timer = 0;
    button.addEventListener("click", function () {
      navigator.clipboard.writeText(text()).then(function () {
        button.classList.add("done");
        button.title = strings.copied || "Copied";
        button.setAttribute("aria-label", strings.copied || "Copied");
        clearTimeout(timer);
        timer = setTimeout(function () {
          button.classList.remove("done");
          button.title = strings.copy || "Copy";
          button.setAttribute("aria-label", strings.copy || "Copy");
        }, 1600);
      });
    });
    return button;
  };

  // What a code block's bar calls its language. Shells share one name.
  var SHELLS = /^(bash|sh|shell|zsh|fish|console|shell-session|shellsession|powershell|ps1|pwsh|cmd|bat|batch)$/;
  var NAMES = {
    json: "JSON", jsonc: "JSON", yaml: "YAML", yml: "YAML", toml: "TOML", xml: "XML", sql: "SQL",
    go: "Go", js: "JavaScript", javascript: "JavaScript", ts: "TypeScript", typescript: "TypeScript", diff: "Diff"
  };

  var languageOf = function (pre) {
    var lang = pre.getAttribute("data-lang");
    if (!lang) {
      var code = pre.querySelector("code");
      var match = code && /(?:^|\s)language-(\S+)/.exec(code.className);
      lang = match ? match[1] : "";
    }
    lang = lang.toLowerCase();
    if (!lang || /^(text|txt|plain|plaintext|none)$/.test(lang)) return "";
    if (SHELLS.test(lang)) return strings.terminal || "Terminal";
    return NAMES[lang] || lang;
  };

  var canCopy = !!(navigator.clipboard && window.isSecureContext !== false);
  document.querySelectorAll(".prose pre").forEach(function (pre) {
    var label = languageOf(pre);
    if (!label && !canCopy) return;
    var box = document.createElement("div");
    box.className = "code-block";
    pre.parentNode.insertBefore(box, pre);
    var bar = null;
    if (label) {
      box.classList.add("has-bar");
      bar = document.createElement("div");
      bar.className = "code-bar";
      var name = document.createElement("span");
      name.textContent = label;
      bar.appendChild(name);
      box.appendChild(bar);
    }
    box.appendChild(pre);
    if (canCopy) {
      var button = copyButton(function () {
        var code = pre.querySelector("code") || pre;
        return code.textContent.replace(/\n$/, "");
      });
      (bar || box).appendChild(button);
    }
  });

  // The section being read, marked in the table of contents.
  var tocLinks = document.querySelectorAll(".toc li a[href^='#']");
  if (tocLinks.length) {
    var linkFor = {};
    var headings = [];
    tocLinks.forEach(function (link) {
      var id = decodeURIComponent(link.hash.slice(1));
      var heading = document.getElementById(id);
      if (heading) {
        linkFor[id] = link;
        headings.push(heading);
      }
    });
    var marked = null;
    var mark = function () {
      var line = parseFloat(getComputedStyle(root).scrollPaddingTop) || 80;
      var reading = null;
      for (var i = 0; i < headings.length; i++) {
        if (headings[i].getBoundingClientRect().top - line - 1 > 0) break;
        reading = headings[i];
      }
      var atEnd = window.innerHeight + window.scrollY >= root.scrollHeight - 2;
      if (atEnd && reading) reading = headings[headings.length - 1];
      var link = reading ? linkFor[reading.id] : null;
      if (link === marked) return;
      if (marked) marked.classList.remove("active");
      if (link) link.classList.add("active");
      marked = link;
    };
    var pending = false;
    window.addEventListener("scroll", function () {
      if (pending) return;
      pending = true;
      window.requestAnimationFrame(function () {
        pending = false;
        mark();
      });
    }, { passive: true });
    mark();
  }

  var openers = document.querySelectorAll("[data-search]");
  openers.forEach(function (button) {
    var kbd = button.querySelector("kbd");
    if (kbd) kbd.textContent = mac ? "⌘K" : "Ctrl K";
  });

  // With the official search plugin on the site, the search box opens its
  // search of the whole text, and the plugin keeps the shortcuts.
  if (window.KiteSearch) {
    openers.forEach(function (button) {
      button.setAttribute("data-kite-search", "");
      button.hidden = false;
    });
    return;
  }

  // Otherwise, finding a page by its title, among the pages of the docs tree
  // and the header links.
  var entries = [];
  var seen = {};
  var add = function (link, group) {
    var href = link.getAttribute("href");
    var title = link.textContent.trim();
    if (!href || !title || seen[href]) return;
    seen[href] = true;
    entries.push({ href: href, title: title, group: group, external: link.target === "_blank" });
  };
  document.querySelectorAll(".tree .group").forEach(function (group) {
    var title = group.querySelector(".group-title");
    group.querySelectorAll("a").forEach(function (link) {
      add(link, title ? title.textContent.trim() : "");
    });
  });
  document.querySelectorAll(".drawer-nav a").forEach(function (link) { add(link, ""); });

  if (!openers.length || !entries.length || typeof HTMLDialogElement !== "function") return;

  var dialog = document.createElement("dialog");
  dialog.className = "search";
  dialog.setAttribute("aria-label", strings.searchLabel || "Search");
  var field = document.createElement("div");
  field.className = "search-field";
  var icon = openers[0].querySelector("svg");
  if (icon) field.appendChild(icon.cloneNode(true));
  var input = document.createElement("input");
  input.type = "search";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.placeholder = strings.searchPlaceholder || "";
  input.setAttribute("aria-label", strings.searchLabel || "Search");
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-expanded", "true");
  input.setAttribute("aria-controls", "search-results");
  input.setAttribute("aria-autocomplete", "list");
  field.appendChild(input);
  var list = document.createElement("ul");
  list.className = "search-results";
  list.id = "search-results";
  list.setAttribute("role", "listbox");
  dialog.appendChild(field);
  dialog.appendChild(list);
  document.body.appendChild(dialog);

  var shown = [];
  var chosen = 0;

  var highlight = function (text, query) {
    var span = document.createElement("span");
    var at = query ? text.toLowerCase().indexOf(query) : -1;
    if (at < 0) {
      span.textContent = text;
      return span;
    }
    span.appendChild(document.createTextNode(text.slice(0, at)));
    var hit = document.createElement("mark");
    hit.textContent = text.slice(at, at + query.length);
    span.appendChild(hit);
    span.appendChild(document.createTextNode(text.slice(at + query.length)));
    return span;
  };

  var choose = function (index) {
    if (!shown.length) return;
    chosen = (index + shown.length) % shown.length;
    list.querySelectorAll("[role='option']").forEach(function (option, i) {
      option.setAttribute("aria-selected", i === chosen ? "true" : "false");
      if (i === chosen) {
        input.setAttribute("aria-activedescendant", option.id);
        option.scrollIntoView({ block: "nearest" });
      }
    });
  };

  var find = function () {
    var query = input.value.trim().toLowerCase();
    var ranked = [];
    entries.forEach(function (entry, order) {
      var title = entry.title.toLowerCase();
      var rank;
      if (!query) rank = 0;
      else if (title.indexOf(query) === 0) rank = 0;
      else if (title.indexOf(query) > 0) rank = 1;
      else if (entry.group.toLowerCase().indexOf(query) >= 0) rank = 2;
      else return;
      ranked.push({ entry: entry, rank: rank, order: order });
    });
    ranked.sort(function (a, b) { return a.rank - b.rank || a.order - b.order; });
    shown = ranked.slice(0, 50).map(function (item) { return item.entry; });

    list.textContent = "";
    input.removeAttribute("aria-activedescendant");
    if (!shown.length) {
      var empty = document.createElement("li");
      empty.className = "search-empty";
      empty.textContent = strings.searchEmpty || "";
      list.appendChild(empty);
      return;
    }
    shown.forEach(function (entry, i) {
      var option = document.createElement("li");
      option.id = "search-result-" + i;
      option.setAttribute("role", "option");
      var link = document.createElement("a");
      link.href = entry.href;
      link.tabIndex = -1;
      if (entry.external) {
        link.target = "_blank";
        link.rel = "noopener";
      }
      link.appendChild(highlight(entry.title, query));
      if (entry.group) {
        var group = document.createElement("span");
        group.className = "result-group";
        group.textContent = entry.group;
        link.appendChild(group);
      }
      option.appendChild(link);
      option.addEventListener("mousemove", function () {
        if (chosen !== i) choose(i);
      });
      list.appendChild(option);
    });
    choose(0);
  };

  var open = function () {
    if (dialog.open) return;
    input.value = "";
    find();
    dialog.showModal();
    input.focus();
  };

  input.addEventListener("input", find);
  input.addEventListener("keydown", function (event) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      choose(chosen + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      choose(chosen - 1);
    } else if (event.key === "Enter" && shown.length) {
      event.preventDefault();
      var link = list.querySelectorAll("[role='option'] a")[chosen];
      if (link) link.click();
    }
  });
  list.addEventListener("click", function (event) {
    if (event.target.closest("a")) dialog.close();
  });
  dialog.addEventListener("click", function (event) {
    if (event.target === dialog) dialog.close();
  });

  openers.forEach(function (button) {
    button.hidden = false;
    button.addEventListener("click", open);
  });
  document.addEventListener("keydown", function (event) {
    var target = event.target;
    var typing = target instanceof HTMLElement &&
      (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
    var slash = event.key === "/" && !typing && !event.metaKey && !event.ctrlKey && !event.altKey;
    var shortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
    if (slash || shortcut) {
      event.preventDefault();
      open();
    }
  });
})();
