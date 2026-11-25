/* Earthsign Travel - site script
   - Mobile menu
   - Packages rendered from data/packages.json, with filters
   - Pay deposit / Pay in full -> /api/create-checkout (Netlify function) -> Yoco
   - Enquiry forms: Netlify Forms, with an email fallback */

(function () {
  "use strict";

  var EMAIL = "earthsignlistings@gmail.com";
  var WHATSAPP = "27737409310";
  var CHECKOUT_ENDPOINT = "/api/create-checkout";

  /* ---------- Menu ---------- */
  var toggle = document.querySelector(".nav-toggle");
  var nav = document.getElementById("nav");
  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      var open = nav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    nav.querySelectorAll("a").forEach(function (a) {
      a.addEventListener("click", function () {
        nav.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
      });
    });
  }

  document.querySelectorAll("[data-year]").forEach(function (el) {
    el.textContent = new Date().getFullYear();
  });

  /* ---------- Reveal on scroll ---------- */
  var reveals = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
      });
    }, { rootMargin: "0px 0px -40px 0px" });
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add("in"); });
  }

  /* ---------- Helpers ---------- */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function rand(cents) {
    var r = cents / 100;
    return "R" + r.toLocaleString("en-ZA", { minimumFractionDigits: r % 1 ? 2 : 0, maximumFractionDigits: 2 });
  }
  function prefillInterest(value) {
    document.querySelectorAll("[data-interest]").forEach(function (sel) {
      var found = Array.prototype.some.call(sel.options, function (o) { return o.text === value; });
      if (!found && value) {
        var opt = document.createElement("option");
        opt.text = value;
        sel.add(opt);
      }
      sel.value = value;
    });
  }

  document.addEventListener("click", function (e) {
    var q = e.target.closest("[data-quote]");
    if (q) prefillInterest(q.getAttribute("data-quote"));
  });

  /* ---------- Packages ---------- */
  var grid = document.querySelector("[data-packages]");
  var filters = document.querySelector("[data-filters]");
  var catalogue = null;

  function lengthMatches(p, len) {
    if (!len) return true;
    var min = p.nightsMin || 0, max = p.nightsMax || min;
    var ranges = { weekend: [1, 3], short: [4, 6], week: [7, 99] };
    var r = ranges[len];
    return max >= r[0] && min <= r[1];
  }

  function card(p) {
    var regions = catalogue.regions || {}, budgets = catalogue.budgets || {};
    var priced = !!p.pricing;
    var tag = p.test ? '<span class="pkg-tag pkg-tag--test">Test only</span>'
      : '<span class="pkg-tag">' + esc(regions[p.region] || p.region) + "</span>";
    var includes = (p.includes || []).map(function (i) { return "<li>" + esc(i) + "</li>"; }).join("");
    var price, actions;
    if (priced) {
      var full = p.pricing.full, dep = p.pricing.deposit;
      price = '<div class="pkg-price">' + (Number.isInteger(full) ? rand(full) : rand(dep)) +
        ' <small>' + esc(p.pricing.basis || "") + "</small></div>" +
        (Number.isInteger(dep) && Number.isInteger(full) ? '<div class="pkg-quote">Deposit ' + rand(dep) + "</div>" : "");
      actions = (Number.isInteger(dep) ? '<button class="btn btn--outline btn--sm" data-pay="deposit" data-id="' + esc(p.id) + '">Pay deposit</button>' : "") +
        (Number.isInteger(full) ? '<button class="btn btn--gold btn--sm" data-pay="full" data-id="' + esc(p.id) + '">Pay in full</button>' : "");
    } else {
      price = '<div class="pkg-quote">Priced to your dates and group. Ask for a quote with live availability.</div>';
      actions = '<a class="btn btn--gold btn--sm" href="#enquire" data-quote="' + esc(p.name) + '">Get a quote</a>';
    }
    return '<article class="pkg">' +
      '<div class="pkg-media"><img src="' + esc(p.image || "images/logo-banner.webp") + '" alt="" loading="lazy">' + tag + "</div>" +
      '<div class="pkg-body">' +
      '<div class="pkg-meta"><span class="chip">' + esc(budgets[p.budget] || p.budget) + '</span><span class="chip">' + esc(p.lengthLabel || "") + "</span></div>" +
      "<h3>" + esc(p.name) + "</h3><p>" + esc(p.summary) + "</p>" +
      (includes ? "<ul>" + includes + "</ul>" : "") + price +
      '<div class="pkg-actions">' + actions + "</div>" +
      '<p class="pkg-error" role="alert"></p>' +
      "</div></article>";
  }

  function render() {
    if (!grid || !catalogue) return;
    var f = filters ? new FormData(filters) : new FormData();
    var region = f.get("region") || "", budget = f.get("budget") || "", len = f.get("length") || "";
    var list = (catalogue.packages || []).filter(function (p) {
      if (p.active === false) return false;
      if (region && p.region !== region) return false;
      if (budget && p.budget !== budget) return false;
      if (len && !lengthMatches(p, len)) return false;
      return true;
    });
    // Priced packages first, test package last.
    list.sort(function (a, b) {
      return (a.test ? 2 : a.pricing ? 0 : 1) - (b.test ? 2 : b.pricing ? 0 : 1);
    });
    grid.innerHTML = list.length ? list.map(card).join("")
      : '<p class="empty">No packages match those filters yet. <a href="#enquire">Ask us for a custom quote</a> and we\'ll find options.</p>';
  }

  function fillSelect(name, map) {
    var sel = filters && filters.querySelector('[name="' + name + '"]');
    if (!sel) return;
    Object.keys(map).forEach(function (k) {
      if (k === "test") return;
      var o = document.createElement("option");
      o.value = k; o.text = map[k];
      sel.add(o);
    });
  }

  if (grid) {
    fetch("data/packages.json", { cache: "no-cache" })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (data) {
        catalogue = data;
        fillSelect("region", data.regions || {});
        fillSelect("budget", data.budgets || {});
        render();
      })
      .catch(function () {
        grid.innerHTML = '<p class="empty">Packages could not load. Please <a href="#enquire">ask us for a quote</a>.</p>';
      });
    if (filters) {
      filters.addEventListener("change", render);
      filters.addEventListener("reset", function () { setTimeout(render, 0); });
      filters.addEventListener("submit", function (e) { e.preventDefault(); });
    }

    grid.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-pay]");
      if (!btn) return;
      var errEl = btn.closest(".pkg").querySelector(".pkg-error");
      errEl.textContent = "";
      var buttons = btn.parentNode.querySelectorAll("button");
      buttons.forEach(function (b) { b.disabled = true; });
      var label = btn.textContent;
      btn.textContent = "Opening secure checkout…";
      fetch(CHECKOUT_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Only the package id and payment type are sent. The server decides the price.
        body: JSON.stringify({ packageId: btn.getAttribute("data-id"), paymentType: btn.getAttribute("data-pay") })
      })
        .then(function (r) {
          return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, d: d }; });
        })
        .then(function (res) {
          if (res.ok && res.d.redirectUrl) {
            window.location.href = res.d.redirectUrl;
            return;
          }
          throw new Error(res.d.error || "Online payments are not available right now.");
        })
        .catch(function (err) {
          var msg = err && err.message && err.message.indexOf("Failed to fetch") === -1 ? err.message : "Online payments are not available right now.";
          errEl.innerHTML = esc(msg) + ' <a href="https://wa.me/' + WHATSAPP + '" target="_blank" rel="noopener">WhatsApp us</a> to book.';
          buttons.forEach(function (b) { b.disabled = false; });
          btn.textContent = label;
        });
    });
  }

  /* ---------- Enquiry forms ----------
     On Netlify, submissions go to Netlify Forms (set email notifications to
     earthsignlistings@gmail.com in the Netlify dashboard). If the POST fails
     (e.g. while still hosted on GitHub Pages), we open a pre-filled email. */
  document.querySelectorAll("[data-enquiry-form]").forEach(function (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var status = form.querySelector(".form-status");
      var submit = form.querySelector('[type="submit"]');
      var data = new FormData(form);
      if (data.get("bot-field")) return;
      submit.disabled = true;
      status.className = "form-status";
      status.textContent = "Sending…";

      var body = new URLSearchParams(data).toString();
      fetch("/", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body })
        .then(function (r) {
          if (!r.ok) throw new Error(r.status);
          window.location.href = "enquiry-sent.html";
        })
        .catch(function () {
          var lines = [];
          data.forEach(function (v, k) {
            if (["form-name", "bot-field"].indexOf(k) === -1 && v) lines.push(k.replace(/_/g, " ") + ": " + v);
          });
          var subject = "Travel enquiry: " + (data.get("interest") || "New trip") + " - " + (data.get("name") || "");
          window.location.href = "mailto:" + EMAIL + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(lines.join("\n"));
          status.className = "form-status ok";
          status.textContent = "Your email app should open with your enquiry ready to send. If it doesn't, email " + EMAIL + " or WhatsApp +27 73 740 9310.";
          submit.disabled = false;
        });
    });
  });
})();
