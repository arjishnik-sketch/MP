// Purpose: browser authoring layer for the server-rendered duty chart — edit mode,
//   staff picker with REAL persistence, quick-create + master edit, रिक्त clear,
//   add-chowki control, finalize/amend, abbreviation tooltips (CSS-driven).
// Current role: production authoring UI (work unit 1009) — served at /chart-authoring.js.
// Last meaningful change: 2026-10-09 — created (replaces the dead inline prototype script
//   that only rewrote cell text and never persisted).//   Constraint/dependency: AGENTS.md hard rules — same-origin relative fetches ONLY (local-only),
//   no modal text-prompt hacks, no fake saves: every visual change goes through the narrow PATCH API and a
//   reload reads back from PostgreSQL. All chrome is .no-print / media-print hidden.
//   Browser code lives in web/ so the local-only static scan over db/server/scripts stays true.
(function () {
  "use strict";

  var DATE = document.body.getAttribute("data-chart-date") || "";
  var LIFECYCLE = document.body.getAttribute("data-lifecycle") || "";
  var mastersPromise = null;
  var mastersData = null;   // resolved masters (ranks/staff/locations/duties/units)
  var flyer = null;          // current dialog state
  var slotCtx = null;        // slot being edited
  var busy = false;

  // ---------- tiny helpers ----------------------------------------------------
  function el(tag, attrs, html) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (html != null) n.innerHTML = html;
    return n;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function api(path, opts) {
    var o = opts || {};
    // Only declare a JSON body when one is actually sent: Fastify rejects a request that
    // announces application/json with an empty body (it broke every DELETE call).
    if (o.body) o.headers = o.headers || { "Content-Type": "application/json" };
    return fetch(path, o).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok) throw new Error(body.error || ("HTTP " + res.status));
        return body;
      });
    });
  }
  var toastTimer = null;
  function toast(msg, kind) {
    var old = document.querySelector(".toast");
    if (old) old.remove();
    var t = el("div", { class: "toast no-print " + (kind || ""), role: "status" }, esc(msg));
    document.body.appendChild(t);
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.remove(); }, 3200);
  }
  // Success feedback survives the reload: stash it, show it on the fresh page.
  function reloadSoon(ms, msg) {
    if (msg) { try { sessionStorage.setItem("pd_toast", msg); } catch (e) { /* ignore */ } }
    setTimeout(function () { location.reload(); }, ms || 500);
  }

  function loadMasters() {
    if (!mastersPromise) {
      mastersPromise = api("/api/masters").then(function (m) {
        mastersData = m;
        return m;
      }).catch(function (e) {
        toast("मास्टर डेटा लोड झाला नाही: " + e.message, "err");
        mastersData = { ranks: [], staff: [], locations: [], duties: [], units: [] };
        return mastersData;
      });
    }
    return mastersPromise;
  }
  function rankShort(code) {
    var list = (mastersData && mastersData.ranks) || [];
    var r = list.find(function (x) { return x.rank_code === code; });
    return (r && r.short_form_mr) || code || "";
  }
  function staffLabel(s) {
    var buck = s.buckle_no ? " " + s.buckle_no : "";
    return rankShort(s.rank_code) + buck + " " + (s.name_mr || "");
  }

  // ---------- EN ⇄ मराठी लिप्यंतर (Sanscript + Marathi conventions, offline) ------
  // The transliterator is a REAL library now, not hand-written rules (user 2026-10-13: “maybe use
  // external tools or libraries instead of making that urself from scratch”). Sanscript 1.3.3
  // (MIT, github.com/indic-transliteration/sanscript.js) is a dependency of this repo and is served
  // from this machine — no network call, no key, no upload, so chart data still never leaves the
  // machine. Sanscript is Sanskrit-first, so a thin, explicit MARATHI CONVENTION layer sits on top:
  //   · roman → Devanagari goes through the `optitrans` scheme, where typing “gajendra” already
  //     means गजेंद्र — plain ITRANS would demand an explicit virama to suppress the inherent अ;
  //   · a word-final virama is dropped (Marathi prints गजेंद्र, never गजेन्द्र्);
  //   · a nasal + virama in front of a STOP becomes the anusvara, which is how the station writes
  //     those names (gAngurDe → गांगुर्डे, gajendra → गजेंद्र), while कन्या-style clusters keep
  //     their explicit nasal;
  //   · Devanagari → roman drops the word-final inherent ‘a’ (Marathi schwa deletion: सुनिल → sunil,
  //     पाटील → pATIl, रिक्त → rikt) and folds the anusvara to a plain ‘n’ before a consonant
  //     (गजेंद्र → gajendr, बंद → band), so the Latin side stays ASCII.
  // Syntax = ITRANS, the scheme the form hints print: aa=आ ii/ee=ई uu/oo=ऊ | T=ट D=ड N=ण L=ळ S=ष |
  // M=ं | r+consonant = र्. A capital at the START of a word is just capitalisation (Patil → पाटील),
  // a capital INSIDE a word is the retroflex marker (paTil → पटिल, gaNesh → गणेश).
  //
  // Nothing is applied to a field silently: a conversion is only SUGGESTED, the clerk reviews (and
  // may edit) it in the review strip, and it lands in the other field only when they accept it —
  // see bilingualPair below (user 2026-10-13: “user should be able to see, verify and edit the
  // converted text before moving on”).
  //
  // Latin codes / protected tokens are NEVER transliterated (AGENTS.md): CCTNS, Dial 112 MERS, DB,
  // MERS, TOTAL, Office, ME and the rank codes (PI/API/PSI/PROB_PSI/GPS/ASI/LASI/HC/LHC/PN/LPN/
  // PC/LPC) are codes and proper nouns, so “CCTNS” must not turn into “छछटनस” and “MERS” stays
  // “MERS”. Devanagari words are always converted in the Latin direction — romanising a name cannot
  // alter its canonical Devanagari spelling, which is the chart's own text.
  var PROTECTED_LATIN = ["CCTNS", "Dial", "MERS", "DB", "TOTAL", "Office", "ME", "PI", "API",
    "PSI", "PROB_PSI", "GPS", "ASI", "LASI", "HC", "LHC", "PN", "LPN", "PC", "LPC", "BIMA"];
  function isProtectedLatin(tok) {
    var bare = String(tok).replace(/^[("'\u201c]+/, "").replace(/[.,;:!?)"'\u201d]+$/, "");
    for (var i = 0; i < PROTECTED_LATIN.length; i++) {
      if (bare.toLowerCase() === PROTECTED_LATIN[i].toLowerCase()) return true;
    }
    return false;
  }
  /** The loaded library, or null when it did not arrive — the aid then does nothing rather than
   *  guessing at a name (a silently wrong name is worse than no suggestion at all). */
  function translitEngine() {
    var S = (typeof window !== "undefined") ? window.Sanscript : null;
    return (S && typeof S.t === "function") ? S : null;
  }
  function translitReady() { return translitEngine() !== null; }
  /** One word: roman (ITRANS) → Devanagari, with the Marathi conventions above. */
  function romanWord(word) {
    var S = translitEngine();
    if (!S) return null;
    if (!/[A-Za-z]/.test(word)) return word;              // digits/punctuation only — untouched
    if (/[\u0900-\u097F]/.test(word)) return word;        // already Devanagari — untouched
    if (isProtectedLatin(word)) return word;              // codes are never transliterated
    // Capital E/O are the same vowel a clerk means by e/o (this aid has no short-e vowel). Every
    // OTHER capital keeps its ITRANS meaning — A=आ, I=ई, T=ट, N=ण, S=ष, L=ळ — because a name that
    // starts with a long vowel is the common case, not an exception (Aher → आहेर, Akash → आकाश).
    // A word-initial capital that is not one of those keys (Patil, Deshmukh) is read as the plain
    // letter, which is how the old aid read it too.
    // A word-initial capital that carries no ITRANS meaning is plain capitalisation (Patil →
    // पतिल, Sanjay → संजय, Dattatray → दत्तात्रय — how a clerk writes a name in English). The
    // letters that DO carry ITRANS meaning stay as typed: A/I/U are the long vowels (Aher → आहेर,
    // Akash → आकाश) and T is the retroflex ट (Tukaram → टुकाराम), which is what Marathi names need.
    var w = word.replace(/E/g, "e").replace(/O/g, "o")
      .replace(/^([BCDFGHJKLNPQSVWXYZ])/, function (m) { return m.toLowerCase(); });
    var dev = S.t(w, "itrans", "devanagari");
    dev = dev.replace(/्(?=\s|$)/g, "");                  // no printed word-final virama
    dev = dev.replace(/्$/, "");
    // Marathi writes a homorganic nasal before a stop as the anusvara (gajendra → गजेंद्र,
    // gAngurDe → गांगुर्डे) — but a doubled nasal is a real conjunct, so न्न stays न्न (jagannAth).
    return dev.replace(/([\u0919\u091e\u0923\u0928\u092e])्(?=[\u0915-\u092d])/g,
      function (m, nasal, off, whole) { return whole.charAt(off + 2) === nasal ? m : "ं"; });
  }
  /** One word: Devanagari → roman (ITRANS), with Marathi schwa deletion. */
  function devWord(word) {
    var S = translitEngine();
    if (!S) return null;
    if (!/[\u0900-\u097F]/.test(word)) return word;       // digits/punctuation only — untouched
    var roman = S.t(word, "devanagari", "itrans");
    // The anusvara becomes a plain ASCII ‘n’ only where it IS a nasal+stop — before a stop letter.
    // Before a semivowel or sibilant it keeps ITRANS' ‘M’ (सांव... stays sAMv..., never “sanv…”),
    // so the roman form round-trips back to the same Devanagari.
    roman = roman.replace(/M(?=[kKgGcCjJtTdDnNpPbB])/g, "n");
    return roman.replace(/a$/, "");                       // the word-final inherent ‘a’ is silent
  }
  /** Convert word by word; whitespace and the original text survive exactly. */
  function mapWords(text, fn) {
    return String(text || "").split(/(\s+)/).map(function (tok) {
      if (!tok.trim()) return tok;
      var out = fn(tok);
      return out === null ? tok : out;
    }).join("");
  }
  /** Latin/roman → Devanagari. Input is returned unchanged when the library is unavailable. */
  function romanToDev(input) { return mapWords(input, romanWord); }
  /** Devanagari → Latin/roman (ITRANS), Marathi conventions. */
  function devToRoman(input) { return mapWords(input, devWord); }

  // ---------- the bilingual field pair, with a REVIEW step ---------------------
  /** Two script fields for ONE value, either one usable for typing. A conversion is never written
   *  straight into the other field: it is offered in a review strip where the clerk sees it, may
   *  edit it, and accepts it (वापरा / Use) or drops it (रद्द / Cancel). A field the clerk edited by
   *  hand always wins, and the pair is inert when the library did not load (two plain inputs). */
  function bilingualPair(mrEl, enEl, opts) {
    var container = (mrEl && mrEl.parentNode) || null;
    if (!container || !mrEl || !enEl || !translitEngine()) return null;
    opts = opts || {};
    var what = opts.whatMr || "मजकूर";
    var whatEn = opts.whatEn || "text";
    var strip = el("div", { class: "tl-strip", hidden: "hidden" });
    strip.innerHTML =
      '<span class="tl-lbl"></span>' +
      '<input type="text" class="tl-prev" aria-label="रूपांतरित मजकूर / converted text">' +
      '<button type="button" class="tl-ok"><span data-lang="mr">वापरा</span><span data-lang="en">Use</span></button>' +
      '<button type="button" class="tl-no"><span data-lang="mr">रद्द</span><span data-lang="en">Cancel</span></button>' +
      '<span class="tl-what"></span>';
    container.appendChild(strip);
    var prev = strip.querySelector(".tl-prev");
    var lbl = strip.querySelector(".tl-lbl");
    var whatEl = strip.querySelector(".tl-what");
    var pending = null;
    var silent = false;
    mrEl.setAttribute("data-tl", "mr");
    enEl.setAttribute("data-tl", "en");
    whatEl.innerHTML = '<span data-lang="mr">' + esc(what) + '</span><span data-lang="en">' + esc(whatEn) + "</span>";
    function hide() { strip.hidden = true; pending = null; }
    function offer(target, converted, toMr) {
      if (converted === null || converted === "" || converted === target.value) { hide(); return; }
      pending = target;
      lbl.innerHTML = toMr
        ? '<span data-lang="mr">सुचवलेले मराठी रूप</span><span data-lang="en">Suggested Marathi</span>'
        : '<span data-lang="mr">सुचवलेले इंग्रजी रूप</span><span data-lang="en">Suggested English</span>';
      prev.value = converted;
      strip.hidden = false;
      prev.focus();
      try { prev.setSelectionRange(prev.value.length, prev.value.length); } catch (e) { /* not text-like */ }
    }
    function apply() {
      if (!pending) return;
      var target = pending;
      var value = prev.value;
      hide();
      silent = true;
      target.value = value;
      silent = false;
      if (opts.onApply) opts.onApply(target, value);
    }
    mrEl.addEventListener("input", function () {
      if (silent) return;
      offer(enEl, devToRoman(mrEl.value), false);
    });
    enEl.addEventListener("input", function () {
      if (silent) return;
      offer(mrEl, romanToDev(enEl.value), true);
    });
    strip.querySelector(".tl-ok").addEventListener("click", apply);
    strip.querySelector(".tl-no").addEventListener("click", hide);
    prev.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); apply(); }
      if (e.key === "Escape") { e.preventDefault(); hide(); }
    });
    return { hide: hide, apply: apply };
  }
  /** A Latin typing companion for a single-field editor: the field keeps the chart's own text, the
   *  companion is where a clerk may type roman, and the same review strip turns it into Marathi
   *  (or shows the Latin form of what is already there). Every text field in every flyer gets one,
   *  so the aid is uniform and no editor can silently drift out of it. */
  /** Fields that are NOT prose: numbers, phone numbers, buckle numbers, search boxes. A name is
   *  transliterated; a buckle number is not. */
  function isNonProseField(input) {
    var id = (input.id || "") + " " + (input.className || "");
    var ph = (input.getAttribute("placeholder") || "") + " " + (input.getAttribute("aria-label") || "");
    if (/buckle|phone|search|numeric|tel|no\b|num\b/i.test(id)) return true;
    if (/बकल|फोन|शोध|क्रमांक|number|buckle|phone|search|ddd/i.test(ph)) return true;
    if (input.getAttribute("inputmode") === "numeric") return true;
    if (input.getAttribute("type") && input.getAttribute("type") !== "text") return true;
    return false;
  }
  function mountBilingualCompanion(input) {
    if (!input || !translitEngine()) return;
    if (input.getAttribute("data-tl")) return;                        // part of an explicit pair
    if (isNonProseField(input)) return;                               // a buckle number is not a name
    var row = input.parentNode;
    if (!row || row.querySelector("[data-tl-en]")) return;            // already mounted in this form
    var label = input.getAttribute("aria-label") || input.getAttribute("placeholder") || "मजकूर";
    var companion = el("input", {
      type: "text", "data-tl-en": "1", class: "tl-roman",
      placeholder: "इंग्रजी/रोमन — उदा. gajendra pATIl",
      "aria-label": label + " — इंग्रजी/रोमन रूप",
    });
    input.parentNode.insertBefore(companion, input.nextSibling);
    bilingualPair(input, companion, { whatMr: label, whatEn: "roman form" });
  }
  /** Every text field inside a flyer body gets the companion (one per form). */
  function mountBilingualCompanions(root) {
    if (!root || !translitEngine()) return;
    // Every `<input>` is offered one; `isNonProseField` is what rejects the checkboxes, ranks,
    // buckles, phones and search boxes — not the selector, because an input with no `type`
    // attribute IS a text field and `[type="text"]` would silently skip it (found live).
    var inputs = root.querySelectorAll(".flyer-mini-form input");
    for (var i = 0; i < inputs.length; i++) mountBilingualCompanion(inputs[i]);
  }
  // ---------- edit mode -------------------------------------------------------
  function isEdit() { return document.body.classList.contains("mode-edit"); }
  function setMode(on) {
    document.body.classList.toggle("mode-edit", on);
    try { sessionStorage.setItem("pd_mode", on ? "edit" : "preview"); } catch (e) { /* private mode */ }
    var btn = document.getElementById("mode-btn");
    // ONE language at a time, no emoji — the label swaps through the same [data-lang] rule as
    // the rest of the chrome (user correction 2026-10-13).
    if (btn) {
      btn.innerHTML = on
        ? '<span data-lang="mr">पूर्वावलोकन</span><span data-lang="en">Preview</span>'
        : '<span data-lang="mr">संपादन</span><span data-lang="en">Edit</span>';
    }
    // Every editable thing gets keyboard access in edit mode — seats, names, values, notice
    // lines and the chart-local table/column cells all share one rule.
    document.querySelectorAll(".dt td.slot, .sr-pi-body .v.slot, [data-label], .val[data-value-key], .notice-line, [data-table-cell], [data-table-col], [data-table-title], [data-matrix-cell]").forEach(function (node) {
      if (on) {
        node.setAttribute("tabindex", "0");
        node.setAttribute("role", "button");
        node.setAttribute("aria-label", "संपादन करा: " + node.textContent.trim());
      } else {
        node.removeAttribute("tabindex");
        node.removeAttribute("role");
        node.removeAttribute("aria-label");
      }
    });
    if (!on) closeFlyer();
  }

  // ---------- slot context ----------------------------------------------------
  function slotContext(td) {
    var staff = td.getAttribute("data-staff");
    return {
      el: td,
      id: Number(td.getAttribute("data-asn")),
      staffId: staff ? Number(staff) : null,
      isBima: td.getAttribute("data-bima") === "1",
      shift: td.getAttribute("data-shift"),
      text: td.textContent.trim(),
      label: slotLabel(td),
    };
  }
  function slotLabel(td) {
    var tr = td.closest("tr");
    var th = tr && (tr.querySelector("th.role") || tr.querySelector("th.bima-lb"));
    if (th && th.textContent.trim()) return th.textContent.trim();
    var blk = td.closest(".blk");
    if (blk) {
      var nm = blk.querySelector(".ch-head .nm") || blk.querySelector(".bh .nm");
      if (nm) return nm.textContent.trim();
    }
    // the Sr-PI card has no `.blk` heading — its group label (रायटर: / चालक: / …) names the seat
    var grp = td.closest(".grp");
    if (grp) {
      var glb = grp.querySelector(".lb");
      if (glb && glb.textContent.trim()) return glb.textContent.trim();
    }
    return "कर्तव्य";
  }

  // ---------- flyer shell -----------------------------------------------------
  function buildFlyer() {
    var overlay = el("div", { class: "flyer-overlay no-print", id: "flyer-overlay", hidden: "hidden" });
    overlay.innerHTML =
      '<div class="flyer-card" role="dialog" aria-modal="true" aria-labelledby="flyer-title">' +
      '  <div class="flyer-header"><h3 id="flyer-title">कर्मचारी निवडा</h3>' +
      '    <button type="button" class="flyer-close" id="flyer-close" aria-label="बंद करा">✕</button></div>' +
      '  <div class="flyer-body" id="flyer-body"></div>' +
      "</div>";
    document.body.appendChild(overlay);
    overlay.addEventListener("click", function (e) { if (e.target === overlay) closeFlyer(); });
    document.getElementById("flyer-close").addEventListener("click", closeFlyer);
    flyer = overlay;
  }
  function ensureFlyer() { if (!flyer) buildFlyer(); }
  function openFlyerShell(title) {
    ensureFlyer();
    document.getElementById("flyer-title").textContent = title;
    flyer.hidden = false;
    // EVERY flyer's prose field gets the bilingual companion here — one hook, so a new editor can
    // never ship without the aid (and never has to remember to add it).
    mountBilingualCompanions(document.getElementById("flyer-body"));
    var first = flyer.querySelector("input, button.flyer-close");
    if (first) first.focus();
  }
  function closeFlyer() {
    if (flyer) flyer.hidden = true;
    slotCtx = null;
    busy = false;
  }

  // ---------- staff picker ----------------------------------------------------
  function openStaffPicker(ctx) {
    slotCtx = ctx;
    ensureFlyer();   // shell must exist before we fill #flyer-body
    loadMasters().then(function (m) {
      if (!slotCtx) return;
      var body = document.getElementById("flyer-body");
      var cur = m.staff.find(function (s) { return Number(s.staff_id) === ctx.staffId; });
      var curHtml = ctx.staffId
        ? '<div class="flyer-slot-info" id="slot-info">' + esc(ctx.label) + ": " + esc(ctx.text) + "</div>" +
          '<div id="cur-block">' +
          (cur ? '<p style="font-size:12px; color:#334155; margin:6px 0 4px;">सध्या: <b>' + esc(cur.name_mr) + "</b> (" + esc(rankShort(cur.rank_code)) + (cur.buckle_no ? " " + esc(cur.buckle_no) : "") + ")</p>" : "") +
          '<div class="flyer-actions">' +
          '  <button type="button" class="flyer-btn-ghost" data-act="edit-master">कर्मचाऱ्याची माहिती बदला</button>' +
          '  <button type="button" class="flyer-btn-danger" data-act="clear">रिक्त करा</button>' +
          "</div>" +
          '<label style="font-size:11.5px; display:flex; gap:6px; align-items:center; margin-top:8px; color:#334155;">' +
          '  <input type="checkbox" id="bima-toggle"' + (ctx.isBima ? " checked" : "") + "> बिमा (स्पष्ट निवड — फक्त ह्या नेमणुकीसाठी)</label>" +
          "</div>"
        : '<div class="flyer-slot-info" id="slot-info">' + esc(ctx.label) + ': <span style="color:#b45309;">सध्या रिक्त</span></div>';

      body.innerHTML = curHtml +
        '<div class="flyer-opt" style="cursor:default;">' +
        "  <h4>[१] हजर कर्मचारी निवडा</h4>" +
        "  <p>नाव, इंग्रजी नाव, बकल नंबर किंवा हुद्द्याने शोधा</p>" +
        '  <input type="search" id="staff-search" class="flyer-search" placeholder="🔍 नाव / बकल / हुद्दा..." aria-label="कर्मचारी शोधा">' +
        '  <div class="flyer-list" id="staff-list" role="listbox" aria-label="कर्मचारी यादी"></div>' +
        "</div>" +
        '<div class="flyer-opt" style="cursor:default;">' +
        "  <h4>[२] ➕ नवीन कर्मचारी जोडा</h4>" +
        "  <p>मास्टर रोस्टरमध्ये नवीन नोंद करून तात्काळ नियुक्त करा</p>" +
        '  <div class="flyer-mini-form">' +
        '   <input id="nc-name" placeholder="पूर्ण नाव मराठीत (उदा. पोशि ४५२ पवार)" aria-label="पूर्ण नाव मराठीत">' +
        '   <input id="nc-nameen" placeholder="Full name in English — auto-converts to Marathi" aria-label="पूर्ण नाव इंग्रजीत">' +
        '   <p class="tr-hint">इंग्रजीत टाइप करा → मराठी आपोआप भरते. ट/ड/ण/ळ साठी T/D/N/L, आ साठी aa.</p>' +
        '   <select id="nc-rank" aria-label="हुद्दा"></select>' +
        '   <input id="nc-buckle" placeholder="बकल नंबर (ऐच्छिक)" aria-label="बकल नंबर">' +
        '   <button type="button" class="flyer-btn-submit" id="nc-submit">सेव्ह व नियुक्त करा</button>' +
        "  </div>" +
        "</div>";

      var rankSel = document.getElementById("nc-rank");
      (m.ranks || []).forEach(function (r) {
        rankSel.appendChild(el("option", { value: r.rank_code }, esc(r.name_mr)));
      });

      document.getElementById("staff-search").addEventListener("input", function (e) {
        renderStaffList(e.target.value);
      });
      bilingualPair(document.getElementById("nc-name"), document.getElementById("nc-nameen"),
        { whatMr: "नाव", whatEn: "name" });
      mountBilingualCompanions(document.getElementById("flyer-body"));
      document.getElementById("nc-submit").addEventListener("click", quickCreate);
      renderStaffList("");
      openFlyerShell("कर्मचारी निवडा — " + ctx.label);
    });
  }

  function renderStaffList(q) {
    if (!mastersData) return;
    var list = document.getElementById("staff-list");
    if (!list) return;
    var query = (q || "").trim().toLowerCase();
    var active = (mastersData.staff || []).filter(function (s) { return s.active !== false; });
    var matched = active.filter(function (s) {
      if (!query) return true;
      return (s.name_mr && s.name_mr.toLowerCase().indexOf(query) >= 0) ||
        (s.name_en && s.name_en.toLowerCase().indexOf(query) >= 0) ||
        (s.buckle_no && String(s.buckle_no).indexOf(query) >= 0) ||
        (s.rank_code && s.rank_code.toLowerCase().indexOf(query) >= 0) ||
        (s.rank_code && rankShort(s.rank_code).toLowerCase().indexOf(query) >= 0);
    }).slice(0, 40);
    if (!matched.length) {
      list.innerHTML = '<div style="padding:8px; color:#94a3b8; font-size:11px;">कोणताही कर्मचारी सापडला नाही</div>';
      return;
    }
    list.innerHTML = "";
    matched.forEach(function (s) {
      var item = el("div", {
        class: "flyer-item", "data-staff": s.staff_id, role: "option", tabindex: "0",
      }, esc(staffLabel(s)));
      if (slotCtx && Number(s.staff_id) === slotCtx.staffId) item.classList.add("sg-top");
      item.addEventListener("click", function () { assignToSlot(Number(s.staff_id)); });
      item.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); assignToSlot(Number(s.staff_id)); }
      });
      list.appendChild(item);
    });
  }

  // ---------- real persistence paths ----------------------------------------
  function patchAssignment(body) {
    if (!slotCtx || busy) return;
    busy = true;
    setBusyButtons("जतन होत आहे...");
    api("/api/charts/" + DATE + "/assignments/" + slotCtx.id, {
      method: "PATCH", body: JSON.stringify(body),
    }).then(function () {
      closeFlyer();
      reloadSoon(400, "✓ जतन झाले — PostgreSQL मध्ये सुरक्षित");
    }).catch(function (e) {
      busy = false;
      setBusyButtons(null);
      toast("जतन अयशस्वी: " + e.message, "err");
    });
  }
  function setBusyButtons(label) {
    document.querySelectorAll("#flyer-body button").forEach(function (b) {
      if (label) { b.disabled = true; if (b.dataset.orig == null) b.dataset.orig = b.textContent; b.textContent = label; }
      else if (b.dataset.orig) { b.disabled = false; b.textContent = b.dataset.orig; }
    });
  }
  function assignToSlot(staffId) { patchAssignment({ staffId: staffId }); }

  function quickCreate() {
    var name = (document.getElementById("nc-name").value || "").trim();
    var nameEn = (document.getElementById("nc-nameen").value || "").trim();
    var rank = document.getElementById("nc-rank").value;
    var buckle = (document.getElementById("nc-buckle").value || "").trim();
    if (!name && nameEn) name = romanToDev(nameEn);   // typed English only → the Marathi name
    if (!name) { toast("कृपया पूर्ण नाव प्रविष्ट करा", "err"); return; }
    if (!rank) { toast("कृपया हुद्दा निवडा", "err"); return; }
    if (busy) return;
    busy = true;
    setBusyButtons("नोंद होत आहे...");
    api("/api/masters/staff", {
      method: "POST",
      // both scripts are stored (the picker already searches name_mr AND name_en)
      body: JSON.stringify({ name_mr: name, name_en: nameEn || devToRoman(name), rank_code: rank, buckle_no: buckle || null }),
    }).then(function (r) {
      // same real path as any assignment: the new master's REAL id goes into the slot
      return api("/api/charts/" + DATE + "/assignments/" + slotCtx.id, {
        method: "PATCH", body: JSON.stringify({ staffId: r.staff_id }),
      });
    }).then(function () {
      closeFlyer();
      reloadSoon(400, "✓ नवीन कर्मचारी जोडला व तक्त्यावर नेमला");
    }).catch(function (e) {
      busy = false;
      setBusyButtons(null);
      toast("नोंदणी अयशस्वी: " + e.message, "err");
    });
  }

  function openMasterEdit() {
    if (!slotCtx || !slotCtx.staffId || !mastersData) return;
    var s = mastersData.staff.find(function (x) { return Number(x.staff_id) === slotCtx.staffId; });
    if (!s) { toast("कर्मचारी माहिती सापडली नाही", "err"); return; }
    var host = document.getElementById("cur-block");
    host.innerHTML =
      '<div class="flyer-mini-form" style="margin-top:8px;">' +
      ' <label style="font-size:10.5px; color:#64748b;">नाव (मराठी)*<input id="me-name" value="' + esc(s.name_mr) + '"></label>' +
      ' <label style="font-size:10.5px; color:#64748b;">नाव (इंग्रजी)<input id="me-nameen" value="' + esc(s.name_en || "") + '"></label>' +
      ' <p class="tr-hint">एकीकडे टाइप करा → दुसरीकडे आपोआप भरते (T=ट, D=ड, N=ण, L=ळ, aa=आ)</p>' +
      ' <label style="font-size:10.5px; color:#64748b;">बकल नंबर<input id="me-buckle" value="' + esc(s.buckle_no || "") + '"></label>' +
      ' <label style="font-size:10.5px; color:#64748b;">फोन<input id="me-phone" type="tel" value="' + esc(s.phone || "") + '"></label>' +
      ' <div class="flyer-actions"><button type="button" class="flyer-btn-submit" id="me-save">जतन करा</button>' +
      ' <button type="button" class="flyer-btn-ghost" id="me-cancel">परत</button></div>' +
      "</div>";
    bilingualPair(document.getElementById("me-name"), document.getElementById("me-nameen"),
      { whatMr: "नाव", whatEn: "name" });
    mountBilingualCompanions(document.getElementById("flyer-body"));
    document.getElementById("me-cancel").addEventListener("click", function () { openStaffPicker(slotCtx); });
    document.getElementById("me-save").addEventListener("click", function () {
      var nameMr = (document.getElementById("me-name").value || "").trim();
      if (!nameMr) { toast("नाव आवश्यक आहे", "err"); return; }
      busy = true;
      api("/api/masters/staff/" + s.staff_id, {
        method: "PATCH",
        body: JSON.stringify({
          name_mr: nameMr,
          name_en: (document.getElementById("me-nameen").value || "").trim(),
          buckle_no: (document.getElementById("me-buckle").value || "").trim() || null,
          phone: (document.getElementById("me-phone").value || "").trim() || null,
        }),
      }).then(function () {
        closeFlyer();
        reloadSoon(400, "✓ कर्मचारी माहिती अद्ययावत झाली");
      }).catch(function (e) {
        busy = false;
        toast("जतन अयशस्वी: " + e.message, "err");
      });
    });
    document.getElementById("me-name").focus();
  }

  // ---------- add chowki -------------------------------------------------------
  function openAddChowki() {
    if (busy) return;
    ensureFlyer();   // shell must exist before we fill #flyer-body
    busy = true;
    Promise.all([loadMasters(), api("/api/charts/" + DATE)]).then(function (res) {
      busy = false;
      var m = res[0], doc = res[1];
      var present = {};
      (doc.assignments || []).forEach(function (a) {
        if (a.location) present[a.location.locationId] = true;
      });
      var avail = (m.locations || []).filter(function (l) {
        return l.active !== false && (l.kind === "CHOWKI" || l.kind === "MARSHAL_POST") && !present[Number(l.location_id)];
      });
      var body = document.getElementById("flyer-body");
      body.innerHTML =
        '<div class="flyer-slot-info">नवीन चौकी / मार्शल पोस्ट जोडा — डीफॉल्ट रिक्त ओळींसह</div>' +
        '<div class="flyer-opt" style="cursor:default;">' +
        "  <h4>[१] मास्टरमधील चौकी निवडा</h4>" +
        '  <div class="flyer-list" id="chowki-list" style="max-height:200px;"></div>' +
        "</div>" +
        '<div class="flyer-opt" style="cursor:default;">' +
        "  <h4>[२] ➕ नवीन चौकी जोडा (नवीन लोकेशन + ड्युटी)</h4>" +
        '  <div class="flyer-mini-form">' +
        '   <input id="cw-name" placeholder="चौकीचे पूर्ण नाव (मराठीत)" aria-label="चौकीचे नाव">' +
        '   <select id="cw-kind" aria-label="प्रकार"><option value="CHOWKI">चौकी</option><option value="MARSHAL_POST">मार्शल पोस्ट</option></select>' +
        '   <button type="button" class="flyer-btn-submit" id="cw-submit">जोडा</button>' +
        "  </div>" +
        "</div>";
      var list = document.getElementById("chowki-list");
      if (!avail.length) {
        list.innerHTML = '<div style="padding:8px; color:#94a3b8; font-size:11px;">सर्व मास्टर चौक्या या तक्त्यावर आधीच आहेत — खाली नवीन जोडा.</div>';
      } else {
        avail.forEach(function (l) {
          var item = el("div", { class: "flyer-item", tabindex: "0", role: "option" },
            esc(l.name_mr) + ' <span style="color:#94a3b8;">(' + esc(l.kind) + ")</span>");
          var go = function () { addChowki({ locationId: Number(l.location_id) }); };
          item.addEventListener("click", go);
          item.addEventListener("keydown", function (e) {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); }
          });
          list.appendChild(item);
        });
      }
      document.getElementById("cw-submit").addEventListener("click", function () {
        var name = (document.getElementById("cw-name").value || "").trim();
        if (!name) { toast("कृपया चौकीचे नाव प्रविष्ट करा", "err"); return; }
        addChowki({ nameMr: name, kind: document.getElementById("cw-kind").value });
      });
      openFlyerShell("+ चौकी जोडा");
    }).catch(function (e) {
      busy = false;
      toast("चौकी जोडता आली नाही: " + e.message, "err");
    });
  }
  function addChowki(payload) {
    if (busy) return;
    busy = true;
    api("/api/charts/" + DATE + "/chowki", { method: "POST", body: JSON.stringify(payload) })
      .then(function () {
        closeFlyer();
        reloadSoon(400, "✓ चौकी जोडली — दोन्ही पाळ्यांत रिक्त ओळींसह");
      })
      .catch(function (e) {
        busy = false;
        toast("चौकी जोडता आली नाही: " + e.message, "err");
      });
  }

  // ---------- rename a chart-local display name -------------------------------
  // Every editable name renders with data-label (stable element key) + data-default (its
  // SOURCE text — never the overridden one). Two scopes, per the user's ask: this element
  // only, or everywhere the same default name appears on this chart. Blank = clear the
  // override and fall back to the default. Masters/data are never renamed.
  function openRename(target) {
    if (busy || !isEdit()) return;
    ensureFlyer();
    var key = target.getAttribute("data-label") || "";
    var def = target.getAttribute("data-default") || target.textContent.trim();
    var cur = target.textContent.trim();
    var body = document.getElementById("flyer-body");
    body.innerHTML =
      '<div class="flyer-slot-info">' + esc(cur) + "</div>" +
      '<div class="flyer-opt" style="cursor:default;">' +
      "  <h4>नाव बदला (फक्त नाव — डेटा व हुद्दे असेच राहतील)</h4>" +
      '  <div class="flyer-mini-form">' +
      '   <input id="rn-text" value="' + esc(cur) + '" aria-label="नवीन नाव" placeholder="रिक्त सोडल्यास मूळ नाव परतयेईल">' +
      '   <label class="rn-scope"><input type="radio" name="rn-scope" value="element" checked> फक्त हे — या तक्त्याच्या या ठिकाणी</label>' +
      '   <label class="rn-scope"><input type="radio" name="rn-scope" value="all"> सर्वत्र — जिथे हे मूळ नाव आहे तिथे सर्वत्र बदला</label>' +
      '   <div class="flyer-actions"><button type="button" class="flyer-btn-submit" id="rn-save">जतन करा</button>' +
      '   <button type="button" class="flyer-btn-ghost" id="rn-cancel">रद्द</button></div>' +
      "  </div>" +
      "</div>" +
      // Layout controls live WHERE the element is edited (user 2026-10-13: drop the standalone
      // लेआउट button — it only worked with edit mode on and could not be left). Align, compact,
      // hide and a one-tap revert, all for the element you just clicked.
      (target.hasAttribute("data-presentation") ? pvSectionHtml(target) : "");
    wirePvControls(body, key);
    // pre-select the scope that is ACTUALLY renaming this element right now (data-override)
    // — a blank save with that scope then truly reverts the name instead of doing nothing.
    var ovr = target.getAttribute("data-override");
    var radio = document.querySelector('input[name="rn-scope"][value="' + (ovr === "all" ? "all" : "element") + '"]');
    if (radio) radio.checked = true;
    document.getElementById("rn-cancel").addEventListener("click", closeFlyer);
    document.getElementById("rn-save").addEventListener("click", function () {
      if (busy) return;
      var scopeEl = document.querySelector('input[name="rn-scope"]:checked');
      busy = true;
      api("/api/charts/" + DATE + "/labels", {
        method: "PATCH",
        body: JSON.stringify({
          scope: scopeEl ? scopeEl.value : "element",
          key: key,
          defaultText: def,
          text: (document.getElementById("rn-text").value || "").trim(),
        }),
      }).then(function () {
        closeFlyer();
        reloadSoon(400, "✓ नाव जतन झाले");
      }).catch(function (e) {
        busy = false;
        toast("नाव जतन अयशस्वी: " + e.message, "err");
      });
    });
    openFlyerShell("नाव बदला");
    var inp = document.getElementById("rn-text");
    inp.focus();
    inp.select();
  }

  // ---------- add officer box -------------------------------------------------
  // Mirror of openAddChowki: a label (+ optional heading) → a real box with a रिक्त
  // रायटर seat the clerk fills later. No person, timing or BIMA is ever invented.
  function openAddOfficer() {
    if (busy) return;
    ensureFlyer();
    var body = document.getElementById("flyer-body");
    body.innerHTML =
      '<div class="flyer-slot-info">नवीन अधिकारी बॉक्स — डीफॉल्ट रिक्त रायटर ओळीसह</div>' +
      '<div class="flyer-opt" style="cursor:default;">' +
      "  <h4>[१] बॉक्सचे नाव / शाखा</h4>" +
      '  <div class="flyer-mini-form">' +
      '   <input id="ob-label" placeholder="लेबल (उदा. नवीन शाखा / तपास)" aria-label="बॉक्स लेबल">' +
      '   <input id="ob-title" placeholder="शीर्षक (ऐच्छिक — अधिकार्याचे नाव)" aria-label="शीर्षक">' +
      '   <button type="button" class="flyer-btn-submit" id="ob-submit">जोडा</button>' +
      "  </div>" +
      "</div>";
    document.getElementById("ob-submit").addEventListener("click", function () {
      var label = (document.getElementById("ob-label").value || "").trim();
      if (!label) { toast("कृपया बॉक्सचे नाव प्रविष्ट करा", "err"); return; }
      var title = (document.getElementById("ob-title").value || "").trim();
      if (busy) return;
      busy = true;
      api("/api/charts/" + DATE + "/officer", {
        method: "POST",
        body: JSON.stringify({ labelMr: label, titleMr: title || undefined }),
      }).then(function () {
        closeFlyer();
        reloadSoon(400, "✓ अधिकारी बॉक्स जोडला — रिक्त रायटर ओळीसह");
      }).catch(function (e) {
        busy = false;
        toast("बॉक्स जोडता आला नाही: " + e.message, "err");
      });
    });
    openFlyerShell("+ अधिकारी बॉक्स जोडा");
    document.getElementById("ob-label").focus();
  }

  // ---------- remove a clerk-added box / block --------------------------------
  // The undo of `+ अधिकारी बॉक्स` and `+ चौकी जोडा`. Confirmed first, because it deletes the
  // block's own (empty) rows from THIS chart — the master location/duty and the source chart
  // are untouched. The server refuses when a person is assigned in the block (409) or when
  // another block's चार्ज points at the chowki (409); those messages surface in the toast.
  function removeOfficerBox(label) {
    if (busy || !label) return;
    if (!confirm('अधिकारी बॉक्स "' + label + '" काढायचा?\n\nयातील रिक्त जागा या तक्त्यावरून वजा होतील. मास्टर डेटा सुरक्षित राहील.')) return;
    busy = true;
    api("/api/charts/" + DATE + "/officer/" + encodeURIComponent(label), { method: "DELETE" })
      .then(function () { closeFlyer(); reloadSoon(400, "✓ बॉक्स काढला"); })
      .catch(function (e) { busy = false; toast("बॉक्स काढता आला नाही: " + e.message, "err"); });
  }
  function removeChowkiBox(locationId) {
    if (busy || !locationId) return;
    if (!confirm("ही चौकी काढायची?\n\nतिच्या रिक्त ओळी व तिच्या बंद/चार्ज नोंदी या तक्त्यावरून वजा होतील. मास्टर लोकेशन सुरक्षित राहील.")) return;
    busy = true;
    api("/api/charts/" + DATE + "/chowki/" + encodeURIComponent(locationId), { method: "DELETE" })
      .then(function () { closeFlyer(); reloadSoon(400, "✓ चौकी काढली"); })
      .catch(function (e) { busy = false; toast("चौकी काढता आली नाही: " + e.message, "err"); });
  }

  // ---------- lifecycle -------------------------------------------------------
  function finalizeChart() {
    if (!confirm(DATE + " चा तक्ता अंतिम (Finalize) करायचा? नंतर तो वाचनीय (immutable) होईल.")) return;
    api("/api/charts/" + DATE + "/finalize", { method: "POST" })
      .then(function (r) { reloadSoon(500, "✓ तक्ता अंतिम झाले (आवृत्ती v" + r.versionNo + ")"); })
      .catch(function (e) { toast("अंतिम करणे अयशस्वी: " + e.message, "err"); });
  }
  function reopenChart() {
    if (!confirm("हा तक्ता सुधारणेसाठी पुनः DRAFT करायचा? अंतिम snapshot तरीही जपला जाईल (आधीच्या आवृत्ती).")) return;
    api("/api/charts/" + DATE + "/reopen", { method: "POST" })
      .then(function () { reloadSoon(500, "✓ सुधारणेसाठी पुनः DRAFT केले (snapshot जपला)"); })
      .catch(function (e) { toast("अयशस्वी: " + e.message, "err"); });
  }

  // ---------- author-owned VALUES (sign-off lines …) ---------------------------
  // A few lines on the sheet are the author's own text, not machine output (user 2026-10-13,
  // item 12: “only show the person names who's logged in … also make it editable”). They render
  // with data-value-key + the COMPUTED default, are stored per chart in
  // presentation_overrides.values (snapshots at FINALIZE) and never touch a master.
  function openValueEdit(el) {
    if (busy || !isEdit()) return;
    ensureFlyer();
    var key = el.getAttribute("data-value-key") || "";
    var def = el.getAttribute("data-default") || "";
    var cur = el.textContent.trim();
    var clerk = getClerk();
    var clerkText = clerk ? clerkLabel(clerk) : "";
    var body = document.getElementById("flyer-body");
    body.innerHTML =
      '<div class="flyer-slot-info">' + esc(cur || "—") + "</div>" +
      '<div class="flyer-opt" style="cursor:default;">' +
      '  <h4>मजकूर बदला</h4>' +
      '  <p>हा मजकूर तुमचा आहे — तक्त्यावर तसाच छापला जाईल. रिक्त सोडल्यास मूळ मजकूर परत येईल.</p>' +
      '  <div class="flyer-mini-form">' +
      '   <input id="ve-text" value="' + esc(cur) + '" placeholder="मजकूर" aria-label="मजकूर">' +
      (clerkText
        ? '   <button type="button" class="flyer-btn-ghost" id="ve-clerk">लॉगिन केलेला लेखनिक वापरा — ' + esc(clerkText) + "</button>"
        : '   <p class="tr-hint">लॉगिन केल्यास येथे तुमचे नाव आपोआप येईल.</p>') +
      (def !== "" ? '   <p class="tr-hint">मूळ मजकूर: ' + esc(def) + "</p>" : "") +
      '   <div class="flyer-actions"><button type="button" class="flyer-btn-submit" id="ve-save">जतन करा</button>' +
      '   <button type="button" class="flyer-btn-ghost" id="ve-cancel">रद्द</button></div>' +
      "  </div></div>";
    var inp = document.getElementById("ve-text");
    var clerkBtn = document.getElementById("ve-clerk");
    if (clerkBtn) clerkBtn.addEventListener("click", function () { inp.value = clerkText; inp.focus(); });
    document.getElementById("ve-cancel").addEventListener("click", closeFlyer);
    document.getElementById("ve-save").addEventListener("click", function () {
      if (busy) return;
      busy = true;
      api("/api/charts/" + DATE + "/values", {
        method: "PATCH", body: JSON.stringify({ key: key, text: (inp.value || "").trim() }),
      }).then(function () { closeFlyer(); reloadSoon(400, "✓ मजकूर जतन झाला"); })
        .catch(function (e) { busy = false; toast("जतन अयशस्वी: " + e.message, "err"); });
    });
    openFlyerShell("मजकूर बदला");
    inp.focus();
    inp.select();
  }
  // The signed-in clerk's own name replaces the chart's default sign-off text as long as the
  // clerk has not typed a value of their own (a typed value always wins — it is the author's
  // explicit choice). Print picks the DOM up, so the sheet carries the name of whoever prepared
  // it on this machine.
  function paintClerkValues() {
    var c = getClerk();
    if (!c) return;
    var label = clerkLabel(c);
    Array.prototype.forEach.call(document.querySelectorAll('.val[data-value-key="signoff.1"]'), function (el) {
      var def = el.getAttribute("data-default") || "";
      if (el.textContent.trim() !== def.trim() || def.trim() === "") return;  // typed value wins
      el.textContent = label;
      el.setAttribute("data-clerk", "1");
    });
  }

  // ---------- chart-local STRUCTURE: tables, columns, notice lines --------------
  // Everything the clerk can add or delete on the sheet lives in
  // daily_charts.presentation_overrides (tables / matrix) or in chart_notices (notice lines) and
  // is written through two narrow endpoints. No free-form HTML, no new chart geometry.
  function structureOp(payload, okMsg) {
    if (busy) return;
    busy = true;
    api("/api/charts/" + DATE + "/structure", { method: "PATCH", body: JSON.stringify(payload) })
      .then(function () { busy = false; closeFlyer(); reloadSoon(400, okMsg || "✓ जतन झाले"); })
      .catch(function (e) { busy = false; toast("जतन अयशस्वी: " + e.message, "err"); });
  }
  function openTableAdd() {
    if (busy || !isEdit()) return;
    ensureFlyer();
    document.getElementById("flyer-body").innerHTML =
      '<div class="flyer-slot-info">नवीन तक्ता — तक्त्यावर स्वतंत्र बॉक्स म्हणून छापला जाईल</div>' +
      '<div class="flyer-opt" style="cursor:default;">' +
      '  <h4>तक्त्याचे नाव व स्तंभ</h4>' +
      '  <div class="flyer-mini-form">' +
      '   <input id="tb-title" placeholder="तक्त्याचे नाव (उदा. बंदोबस्त तपशील)" aria-label="तक्त्याचे नाव">' +
      '   <input id="tb-cols" value="तपशील, नोंद" aria-label="स्तंभ">' +
      '   <p class="tr-hint">स्तंभ स्वल्पविरामाने वेगळे करा. नंतर ओळी, स्तंभ व मजकूर वाढवता/बदलता येतो.</p>' +
      '   <button type="button" class="flyer-btn-submit" id="tb-save">तक्ता जोडा</button>' +
      "  </div></div>";
    document.getElementById("tb-save").addEventListener("click", function () {
      var title = (document.getElementById("tb-title").value || "").trim();
      if (!title) { toast("तक्त्याचे नाव आवश्यक आहे", "err"); return; }
      var cols = (document.getElementById("tb-cols").value || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
      structureOp({ op: "table.add", title: title, columns: cols.length ? cols : ["तपशील"] }, "✓ तक्ता जोडला");
    });
    openFlyerShell("+ तक्ता जोडा");
    document.getElementById("tb-title").focus();
  }
  function openMatrixColumnAdd() {
    if (busy || !isEdit()) return;
    ensureFlyer();
    document.getElementById("flyer-body").innerHTML =
      '<div class="flyer-slot-info">मनुष्यबळ मॅट्रिक्स — नवीन स्तंभ</div>' +
      '<div class="flyer-opt" style="cursor:default;">' +
      '  <h4>स्तंभाचे शीर्षक</h4>' +
      '  <div class="flyer-mini-form">' +
      '   <input id="mc-label" placeholder="शीर्षक (उदा. होमगार्ड)" aria-label="स्तंभ शीर्षक">' +
      '   <p class="tr-hint">नवीन स्तंभातील आकडे प्रत्येक ओळीत टाइप करून भरता येतात.</p>' +
      '   <button type="button" class="flyer-btn-submit" id="mc-save">स्तंभ जोडा</button>' +
      "  </div></div>";
    document.getElementById("mc-save").addEventListener("click", function () {
      var label = (document.getElementById("mc-label").value || "").trim();
      if (!label) { toast("शीर्षक आवश्यक आहे", "err"); return; }
      structureOp({ op: "matrix.column.add", label: label }, "✓ स्तंभ जोडला");
    });
    openFlyerShell("+ स्तंभ जोडा");
    document.getElementById("mc-label").focus();
  }
  function openCellEdit(el) {
    if (busy || !isEdit()) return;
    ensureFlyer();
    var cur = el.textContent.trim();
    var payload = null;
    var extra = "";
    if (el.hasAttribute("data-table-title")) {
      var tid = el.getAttribute("data-table-title");
      payload = function (text) { return { op: "table.title", id: tid, text: text }; };
      extra = '<button type="button" class="flyer-btn-danger" id="ce-del">हा तक्ता काढा</button>';
    } else if (el.hasAttribute("data-table-col")) {
      var cid = el.getAttribute("data-table-col"), ci = el.getAttribute("data-col");
      payload = function (text) { return { op: "table.col.label", id: cid, index: Number(ci), text: text }; };
      extra = '<button type="button" class="flyer-btn-danger" id="ce-del-col">हा स्तंभ काढा</button>';
    } else if (el.hasAttribute("data-table-cell")) {
      var cellId = el.getAttribute("data-table-cell"), r0 = el.getAttribute("data-row"), c0 = el.getAttribute("data-col");
      payload = function (text) { return { op: "table.cell", id: cellId, row: Number(r0), col: Number(c0), text: text }; };
      extra = '<button type="button" class="flyer-btn-danger" id="ce-del-row">ही ओळ काढा</button>';
    } else {
      var mkey = el.getAttribute("data-matrix-cell");
      payload = function (text) { return { op: "matrix.cell", key: mkey, text: text }; };
    }
    document.getElementById("flyer-body").innerHTML =
      '<div class="flyer-slot-info">' + esc(cur || "(रिक्त)") + "</div>" +
      '<div class="flyer-opt" style="cursor:default;">' +
      '  <h4>मजकूर बदला</h4>' +
      '  <div class="flyer-mini-form">' +
      '   <input id="ce-text" value="' + esc(cur) + '" aria-label="मजकूर">' +
      '   <div class="flyer-actions"><button type="button" class="flyer-btn-submit" id="ce-save">जतन करा</button>' +
      '   <button type="button" class="flyer-btn-ghost" id="ce-cancel">रद्द</button></div>' + extra +
      "  </div></div>";
    document.getElementById("ce-cancel").addEventListener("click", closeFlyer);
    document.getElementById("ce-save").addEventListener("click", function () {
      structureOp(payload((document.getElementById("ce-text").value || "").trim()), "✓ जतन झाले");
    });
    var delCol = document.getElementById("ce-del-col");
    if (delCol) delCol.addEventListener("click", function () {
      if (!confirm("हा स्तंभ काढायचा? त्यातील मजकूर या तक्त्यावरून वजा होईल.")) return;
      structureOp({ op: "table.col.remove", id: el.getAttribute("data-table-col"), index: Number(el.getAttribute("data-col")) }, "✓ स्तंभ काढला");
    });
    var delRow = document.getElementById("ce-del-row");
    if (delRow) delRow.addEventListener("click", function () {
      if (!confirm("ही ओळ काढायची?")) return;
      structureOp({ op: "table.row.remove", id: el.getAttribute("data-table-cell"), index: Number(el.getAttribute("data-row")) }, "✓ ओळ काढली");
    });
    var delTbl = document.getElementById("ce-del");
    if (delTbl) delTbl.addEventListener("click", function () { removeTable(el.getAttribute("data-table-title")); });
    openFlyerShell("मजकूर बदला");
    var inp = document.getElementById("ce-text");
    inp.focus();
    inp.select();
  }
  function removeTable(id) {
    if (busy || !id) return;
    if (!confirm("हा तक्ता काढायचा?\n\nफक्त या तक्त्यावरील नोंद वजा होईल.")) return;
    structureOp({ op: "table.remove", id: id }, "✓ तक्ता काढला");
  }
  // Notice lines live in chart_notices (one row per line) — same narrow-write discipline, its own
  // endpoint, and a FINALIZED chart answers 409 (amendment = new version).
  function openNoticeEdit(noteEl, group) {
    if (busy || !isEdit()) return;
    ensureFlyer();
    var id = noteEl ? Number(noteEl.getAttribute("data-notice")) : null;
    var cur = noteEl ? noteEl.textContent.trim() : "";
    document.getElementById("flyer-body").innerHTML =
      '<div class="flyer-slot-info">' + esc(group || "सूचना") + (id ? " — सूचना क्र. " + id : " — नवीन सूचना") + "</div>" +
      '<div class="flyer-opt" style="cursor:default;">' +
      '  <h4>' + (id ? "सूचना बदला" : "नवीन सूचना") + "</h4>" +
      '  <div class="flyer-mini-form">' +
      '   <input id="nt-text" value="' + esc(cur) + '" placeholder="सूचना मजकूर" aria-label="सूचना मजकूर">' +
      '   <input id="nt-group" value="' + esc(group || "") + '" placeholder="गट (उदा. रात्रगस्त सुचना)" aria-label="गट">' +
      '   <div class="flyer-actions"><button type="button" class="flyer-btn-submit" id="nt-save">जतन करा</button>' +
      '   <button type="button" class="flyer-btn-ghost" id="nt-cancel">रद्द</button></div>' +
      (id ? '<button type="button" class="flyer-btn-danger" id="nt-del">ही सूचना काढा</button>' : "") +
      "  </div></div>";
    document.getElementById("nt-cancel").addEventListener("click", closeFlyer);
    function payload() {
      return {
        id: id, text: (document.getElementById("nt-text").value || "").trim(),
        group: (document.getElementById("nt-group").value || "").trim() || "सूचना",
      };
    }
    document.getElementById("nt-save").addEventListener("click", function () {
      var p = payload();
      if (!p.text) { toast("मजकूर आवश्यक आहे", "err"); return; }
      var call = id
        ? api("/api/charts/" + DATE + "/notices/" + id, { method: "PATCH", body: JSON.stringify({ text: p.text, group: p.group }) })
        : api("/api/charts/" + DATE + "/notices", { method: "POST", body: JSON.stringify({ text: p.text, group: p.group }) });
      busy = true;
      call.then(function () { busy = false; closeFlyer(); reloadSoon(400, "✓ सूचना जतन झाली"); })
        .catch(function (e) { busy = false; toast("जतन अयशस्वी: " + e.message, "err"); });
    });
    var delBtn = document.getElementById("nt-del");
    if (delBtn) delBtn.addEventListener("click", function () {
      if (!confirm("ही सूचना काढायची?")) return;
      busy = true;
      api("/api/charts/" + DATE + "/notices/" + id, { method: "DELETE" })
        .then(function () { busy = false; closeFlyer(); reloadSoon(400, "✓ सूचना काढली"); })
        .catch(function (e) { busy = false; toast("काढता आले नाही: " + e.message, "err"); });
    });
    openFlyerShell(id ? "सूचना बदला" : "+ सूचना");
    document.getElementById("nt-text").focus();
  }

  // ---------- abbreviation tooltip --------------------------------------------
  // The full form of a rank token (वपोनि → वरिष्ठ पोलीस निरीक्षक) appears ABOVE-LEFT of the token
  // on one line. It is a fixed-position layer rather than a CSS ::after bubble because a bubble is
  // clipped by the block's own overflow — user 2026-10-13: “if the parent box ends, inside
  // abbrevation dropdown cuts down, this should not happen”.
  function initAbbrTip() {
    var tip = el("div", { id: "abbr-tip", hidden: "hidden" });
    document.body.appendChild(tip);
    function target(node) {
      return node && node.closest ? node.closest("abbr.abbr[data-full]") : null;
    }
    function show(node) {
      var full = node.getAttribute("data-full") || "";
      if (!full) return;
      tip.textContent = full;
      tip.hidden = false;
      var r = node.getBoundingClientRect();
      var tr = tip.getBoundingClientRect();
      var left = Math.max(6, Math.min(window.innerWidth - tr.width - 6, r.left));
      var top = r.top - tr.height - 5;
      if (top < 6) top = r.bottom + 5;    // no room above the token: flip below it
      tip.style.left = Math.round(left) + "px";
      tip.style.top = Math.round(top) + "px";
    }
    function hide() { tip.hidden = true; }
    document.addEventListener("mouseover", function (e) { var n = target(e.target); if (n) show(n); });
    document.addEventListener("mouseout", function (e) { if (target(e.target)) hide(); });
    document.addEventListener("focusin", function (e) { var n = target(e.target); if (n) show(n); });
    document.addEventListener("focusout", hide);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") hide(); });
    window.addEventListener("scroll", hide, true);
  }

  // ---------- events ----------------------------------------------------------
  function onDocumentClick(e) {
    var t = e.target;
    var act = t.closest && t.closest("[data-act]");
    if (act) {
      var a = act.getAttribute("data-act");
      if (a === "edit-master") { openMasterEdit(); return; }
      if (a === "clear") { patchAssignment({ staffId: null }); return; }
    }
    if (t.id === "bima-toggle") return; // change handler below
    // An UNFILLED Sr-PI support seat (चालक / RTPC दिवस-रात्र) is an ordinary empty cell the
    // clerk fills: the real VACANT_RIKT row is created on demand, then the same staff picker
    // opens for it. No `+ जागा` button any more (user 2026-10-13).
    var newSeat = t.closest && t.closest(".new-seat[data-seat-role]");
    if (newSeat) {
      if (!isEdit() || busy) return;
      var role = newSeat.getAttribute("data-seat-role");
      var shift = newSeat.getAttribute("data-seat-shift");
      busy = true;
      api("/api/charts/" + DATE + "/support", {
        method: "POST", body: JSON.stringify({ role: role, shift: shift }),
      }).then(function (r) {
        busy = false;
        return loadMasters().then(function () {
          openStaffPicker({
            el: newSeat, id: Number(r.assignmentId), staffId: null, isBima: false,
            shift: shift, text: "", label: role + " " + (shift === "NIGHT" ? "रात्रपाळी" : "दिवसपाळी"),
          });
        });
      }).catch(function (e) {
        busy = false;
        if (/आधीच/.test(e.message)) { reloadSoon(400, "ही जागा आधीच होती — तक्ता ताजा होत आहे"); return; }
        toast("जागा तयार झाली नाही: " + e.message, "err");
      });
      return;
    }
    var seatDel = t.closest && t.closest("[data-del-seat]");
    if (seatDel) {
      if (!isEdit() || busy) return;
      if (!confirm("ही जागा काढायची?\n\nजर तिवर कर्मचारी नेमला असेल तर आधी ती जागा रिक्त करा.")) return;
      busy = true;
      api("/api/charts/" + DATE + "/support/" + encodeURIComponent(seatDel.getAttribute("data-del-seat")), { method: "DELETE" })
        .then(function () { busy = false; reloadSoon(400, "✓ जागा काढली"); })
        .catch(function (e) { busy = false; toast("जागा काढता आली नाही: " + e.message, "err"); });
      return;
    }
    var delBtn = t.closest && t.closest("[data-box-del]");
    if (delBtn) {
      if (!isEdit()) return;   // the control is rendered only in edit mode; never act outside it
      if (delBtn.getAttribute("data-box-del") === "officer") {
        removeOfficerBox(delBtn.getAttribute("data-box-label"));
      } else {
        removeChowkiBox(delBtn.getAttribute("data-location-id"));
      }
      return;
    }
    // ---- chart-local structure CRUD (item 11) ----
    var tblDel = t.closest && t.closest("[data-table-del]");
    if (tblDel) { if (isEdit()) removeTable(tblDel.getAttribute("data-table-del")); return; }
    var addRow = t.closest && t.closest("[data-table-add-row]");
    if (addRow) { if (isEdit()) structureOp({ op: "table.row.add", id: addRow.getAttribute("data-table-add-row") }, "✓ ओळ जोडली"); return; }
    var addCol = t.closest && t.closest("[data-table-add-col]");
    if (addCol) { if (isEdit()) structureOp({ op: "table.col.add", id: addCol.getAttribute("data-table-add-col") }, "✓ स्तंभ जोडला"); return; }
    var cellEl = t.closest && t.closest("[data-table-cell], [data-table-col], [data-table-title]");
    if (cellEl) { if (isEdit()) openCellEdit(cellEl); return; }
    var mColAdd = t.closest && t.closest("[data-matrix-col-add]");
    if (mColAdd) { if (isEdit()) openMatrixColumnAdd(); return; }
    var mColDel = t.closest && t.closest("[data-matrix-col-del]");
    if (mColDel) {
      if (isEdit()) structureOp({ op: "matrix.column.remove", key: mColDel.getAttribute("data-matrix-col-del") }, "✓ स्तंभ काढला");
      return;
    }
    var mColHide = t.closest && t.closest("[data-matrix-col-hide]");
    if (mColHide) {
      if (isEdit()) structureOp({ op: "matrix.column.hide", key: mColHide.getAttribute("data-matrix-col-hide") }, "✓ स्तंभ लपवला");
      return;
    }
    var mCell = t.closest && t.closest("[data-matrix-cell]");
    if (mCell) { if (isEdit()) openCellEdit(mCell); return; }
    var nAdd = t.closest && t.closest("[data-notice-add]");
    if (nAdd) { if (isEdit()) openNoticeEdit(null, nAdd.getAttribute("data-notice-add")); return; }
    var note = t.closest && t.closest(".notice-line[data-notice]");
    if (note) { if (isEdit()) openNoticeEdit(note, note.getAttribute("data-notice-group") || ""); return; }
    var tblAdd = t.closest && t.closest("[data-table-add]");
    if (tblAdd) { if (isEdit()) openTableAdd(); return; }
    var addBtn = t.closest && t.closest(".add-box");
    if (addBtn && !addBtn.disabled) {
      if (addBtn.getAttribute("data-add") === "chowki") openAddChowki();
      else if (addBtn.getAttribute("data-add") === "officer") openAddOfficer();
      return;
    }
    // Priority: a SEAT is more specific than the group label around it. Checking [data-label]
    // first made every seat inside a labelled group (e.g. the Sr-PI card's रायटर, whose group
    // carries data-label="support.srpi.writer") open the RENAME flyer instead of the staff
    // picker — the seat became unreachable in edit mode (found live 2026-10-13). Labels that are
    // not seats still rename, and a group label is renameable by clicking its own text.
    var slot = t.closest && t.closest(".slot");
    if (slot && isEdit()) { openStaffPicker(slotContext(slot)); return; }
    // Sign-off / other author-owned VALUES: clicking the value edits the text (not the label).
    var valEl = t.closest && t.closest(".val[data-value-key]");
    if (valEl && isEdit()) { openValueEdit(valEl); return; }
    var nameEl = t.closest && t.closest("[data-label]");
    if (nameEl && isEdit()) { openRename(nameEl); }
  }
  function onDocumentChange(e) {
    if (e.target.id === "bima-toggle" && slotCtx && slotCtx.staffId) {
      patchAssignment({ staffId: slotCtx.staffId, isBima: e.target.checked });
    }
  }
  function onDocumentKeydown(e) {
    if (e.key === "Escape" && flyer && !flyer.hidden) { closeFlyer(); return; }
    if ((e.key === "Enter" || e.key === " ") && e.target.classList && e.target.classList.contains("slot")) {
      if (isEdit() && !e.target.classList.contains("new-seat")) { e.preventDefault(); openStaffPicker(slotContext(e.target)); }
    }
    if ((e.key === "Enter" || e.key === " ") && e.target.hasAttribute && e.target.hasAttribute("data-label")) {
      if (isEdit()) { e.preventDefault(); openRename(e.target); }
    }
  }  // ---------- header: date selector -------------------------------------------
  // Kushal's reference picker, ported to this chrome (user 2026-10-13, item 10: “copy the style
  // and behaviour from there as it is”): a two-line date control (date over weekday, आज chip
  // when it is today) that opens a searchable card grouped आगामी → अलीकडील ७ दिवस → ऐतिहासिक व
  // डेमो तारखा, each row showing the weekday and an availability dot. It is chrome (`.no-print`)
  // and it only NAVIGATES: a date with no chart is muted and inert — the picker never invents a
  // date and never sends the clerk to a page that does not exist.
  var MR_DIGITS = "०१२३४५६७८९";
  var MR_WEEKDAYS = ["रविवार", "सोमवार", "मंगळवार", "बुधवार", "गुरुवार", "शुक्रवार", "शनिवार"];
  var EN_WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  function toMrDate(iso) {
    var p = String(iso).slice(0, 10).split("-");
    if (p.length !== 3) return iso;
    var t = function (s) { return String(s).replace(/\d/g, function (d) { return MR_DIGITS[Number(d)]; }); };
    return t(p[2]) + "/" + t(p[1]) + "/" + t(p[0]);
  }
  function isoOf(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function addDaysIso(iso, delta) {
    var d = new Date(iso + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + delta);
    return d.toISOString().slice(0, 10);
  }
  function wdOf(iso, lang) {
    var d = new Date(iso + "T00:00:00Z");
    if (isNaN(d.getTime())) return "";
    return (lang === "en" ? EN_WEEKDAYS : MR_WEEKDAYS)[d.getUTCDay()];
  }
  function initDateMenu() {
    var btn = document.getElementById("date-btn");
    var menu = document.getElementById("date-menu");
    if (!btn || !menu) return;
    var loaded = false;
    var available = {};
    var todayIso = isoOf(new Date());
    var tomorrowIso = addDaysIso(todayIso, 1);
    if (DATE === todayIso) {
      btn.classList.add("today");
      var chip = el("span", { class: "today-chip" },
        '<span data-lang="mr">आज</span><span data-lang="en">Today</span>');
      var dl = btn.querySelector(".dl");
      (dl || btn).appendChild(chip);
    }
    function close() { menu.hidden = true; btn.setAttribute("aria-expanded", "false"); }
    function dateRow(iso) {
      var isCur = iso === DATE;
      var has = !!available[iso];
      var cls = "dm-item" + (isCur ? " cur" : "") + (iso === todayIso ? " today" : "") + (has ? " live" : " off");
      var badge = iso === todayIso
        ? '<span class="today-chip"><span data-lang="mr">आज</span><span data-lang="en">Today</span></span>'
        : iso === tomorrowIso
          ? '<span class="tom-chip"><span data-lang="mr">उद्या</span><span data-lang="en">Tomorrow</span></span>'
          : "";
      return '<div class="' + cls + '" role="option" tabindex="' + (has && !isCur ? "0" : "-1") + '" data-date="' + esc(iso) + '"' +
        (has ? "" : ' aria-disabled="true"') + ">" +
        '<span class="ddate"><span data-lang="mr">' + esc(toMrDate(iso)) + '</span><span data-lang="en">' + esc(iso.split("-").reverse().join("/")) + "</span>" + badge + "</span>" +
        '<span class="dmeta"><span class="wd"><span data-lang="mr">' + esc(wdOf(iso, "mr")) + '</span><span data-lang="en">' + esc(wdOf(iso, "en")) + "</span></span>" +
        (has ? '<span class="dot" title="तक्ता उपलब्ध"></span>' : '<span class="nodot">तक्ता नाही</span>') + "</span></div>";
    }
    function head(t) { return '<div class="dm-head">' + esc(t) + "</div>"; }
    function render(q) {
      var query = (q || "").trim().toLowerCase();
      var match = function (iso) {
        if (!query) return true;
        return iso.indexOf(query) >= 0 || toMrDate(iso).indexOf(query) >= 0;
      };
      var recent = [];
      for (var i = 0; i < 7; i++) recent.push(addDaysIso(todayIso, -i));
      var recentSet = {};
      recent.forEach(function (d) { recentSet[d] = 1; });
      var historical = Object.keys(available).filter(function (d) { return !recentSet[d] && d !== tomorrowIso; }).sort().reverse();
      if (DATE && !recentSet[DATE] && DATE !== tomorrowIso && historical.indexOf(DATE) < 0) historical.unshift(DATE);
      var sections = [
        { head: "आगामी", items: [tomorrowIso].filter(match) },
        { head: "अलीकडील ७ दिवस", items: recent.filter(match).sort().reverse() },
        { head: "ऐतिहासिक व डेमो तारखा", items: historical.filter(match) },
      ].filter(function (s) { return s.items.length > 0; });
      // The ADVANCED SEARCH icon sits at the right end of the date menu's own search area. It is a
      // WIP entry (badged Coming Soon, disabled-looking) that leads to the same place the navbar's
      // “ऐतिहासिक शोध” leaf does — the full filter/slider screen Kushal's repo builds in
      // HistoricalSearchView.tsx (date + staff + location + duty + operation filters, SlidersHorizontal
      // icon). It deliberately does NOT start a second search implementation here: see
      // docs/BACKLOG.md → “advanced search”, which requires that reference to be read first.
      var advBtn = '<button type="button" class="dm-adv" data-wip="प्रगत शोध / Advanced search"'
        + ' title="प्रगत शोध (Coming Soon)" aria-label="प्रगत शोध — Coming Soon">'
        + '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">'
        + '<path d="M4 7h10M18 7h2M4 17h4M12 17h8M4 12h6M14 12h6"></path>'
        + '<circle cx="16" cy="7" r="2"></circle><circle cx="10" cy="17" r="2"></circle><circle cx="12" cy="12" r="2"></circle>'
        + '</svg><span class="wip-dot">WIP</span></button>';
      var searchRow = '<div class="dm-search"><input id="dm-q" type="search" placeholder="तारीख शोधा (उदा. २१/०९)" value="' + esc(q || "") + '" aria-label="तारीख शोधा">' + advBtn + "</div>";
      if (!sections.length) {
        menu.innerHTML = searchRow + '<div class="dm-none">कोणतीही तारीख सापडली नाही</div>';
      } else {
        menu.innerHTML = searchRow +
          '<div class="dm-list">' + sections.map(function (s) { return head(s.head) + s.items.map(dateRow).join(""); }).join("") + "</div>";
      }
      var q2 = document.getElementById("dm-q");
      if (q2) {
        q2.addEventListener("input", function () { render(q2.value); });
        q2.focus();
      }
      menu.querySelectorAll(".dm-item.live").forEach(function (it) {
        var go = function () { location.href = "/charts/" + it.getAttribute("data-date"); };
        it.addEventListener("click", go);
        it.addEventListener("keydown", function (e) {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); }
        });
      });
    }
    function open() {
      menu.hidden = false;
      btn.setAttribute("aria-expanded", "true");
      if (loaded) { render(""); return; }
      menu.innerHTML = '<div class="dm-none">तारखा लोड होत आहेत…</div>';
      api("/api/charts").then(function (list) {
        loaded = true;
        (list || []).forEach(function (c) { available[c.date] = c; });
        render("");
      }).catch(function () {
        menu.innerHTML = '<div class="dm-none">तारखा लोड झाल्या नाहीत</div>';
      });
    }
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (menu.hidden) open(); else close();
    });
    document.addEventListener("click", function (e) {
      if (!menu.hidden && !menu.contains(e.target) && e.target !== btn) close();
    });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !menu.hidden) close(); });
  }

  // ---------- pseudo-login (local only: no password, no server account) --------
  // Who is preparing this chart (तक्ता तयार करणारे हजेरी लेखनिक). The choice lives in this
  // browser only (localStorage) — the chart data in PostgreSQL is never touched, nothing leaves
  // the machine and there is no credential to leak. The buckle number is only asked for ranks
  // that actually carry one (cadre = CONSTABULARY); officers have none.
  var CLERK_KEY = "pd_clerk";
  // Devanagari digits are a display transform only (stored values stay Latin) — same rule as the
  // server renderer, so the header reads exactly like the chart it belongs to (पोशि ५६९, not 569).
  function mrDigits(s) {
    return String(s == null ? "" : s).replace(/\d/g, function (d) { return MR_DIGITS[Number(d)]; });
  }
  function getClerk() {
    try { return JSON.parse(localStorage.getItem(CLERK_KEY) || "null"); } catch (e) { return null; }
  }
  function clerkLabel(c) {
    if (!c) return "लॉगिन";
    return (c.rankShort || c.rankCode || "") +
      (c.buckleNo ? " " + mrDigits(c.buckleNo) : "") + " " + (c.nameMr || "");
  }
  function paintClerk() {
    var el = document.getElementById("ab-user");
    if (!el) return;
    var c = getClerk();
    el.textContent = c ? "लॉगिन: " + clerkLabel(c) : "लॉगिन";
    el.classList.toggle("on", !!c);
    el.title = c
      ? "तक्ता तयार करणारे हजेरी लेखनिक: " + clerkLabel(c)
      : "हजेरी लेखनिक म्हणून लॉगिन करा";
  }
  function setClerk(c) {
    try {
      if (c) localStorage.setItem(CLERK_KEY, JSON.stringify(c));
      else localStorage.removeItem(CLERK_KEY);
    } catch (e) { /* private mode: the chip simply stays signed out */ }
    paintClerk();
  }
  function buckleApplies(rankCode) {
    var r = ((mastersData && mastersData.ranks) || []).find(function (x) { return x.rank_code === rankCode; });
    return !!(r && r.cadre === "CONSTABULARY");
  }
  function openLogin() {
    ensureFlyer();
    busy = true;
    Promise.all([loadMasters(), api("/api/charts/" + DATE)]).then(function (res) {
      busy = false;
      var m = res[0], doc = res[1];
      var cur = getClerk();
      // Candidates = the chart's own हजेरी मास्तर / तयार करणारे हजेरी लेखनिक rows; if the source
      // names none, the clerk picks any active staff member from the master.
      var cands = [];
      (doc.assignments || []).forEach(function (a) {
        if (a.person && (a.dutyCode === "OFFICE_HAZARI_MASTER" || a.roleMr === "हजेरी मास्तर")) cands.push(a.person);
      });
      var seen = {};
      cands = cands.filter(function (p) { if (seen[p.staffId]) return false; seen[p.staffId] = 1; return true; });
      // The login window follows the मराठी/EN toggle like the rest of the chrome (user
      // 2026-10-13, item 6) — every label ships both scripts, CSS shows one at a time.
      function bi(mrText, enText) {
        return '<span data-lang="mr">' + mrText + '</span><span data-lang="en">' + enText + "</span>";
      }
      var body = document.getElementById("flyer-body");
      body.innerHTML =
        '<div class="flyer-slot-info">' + bi("तक्ता तयार करणारे हजेरी लेखनिक — " + esc(DATE), "Clerk preparing this chart — " + esc(DATE)) + "</div>" +
        (cur ? '<p style="font-size:12px; color:#334155; margin:6px 0 4px;">' + bi("सध्या लॉगिन: ", "Signed in as: ") + "<b>" + esc(clerkLabel(cur)) + "</b></p>" : "") +
        '<div class="flyer-opt" style="cursor:default;">' +
        "  <h4>" + bi("[१] तक्त्यावरील हजेरी लेखनिक निवडा", "[1] Pick a clerk from this chart") + "</h4>" +
        '  <div class="flyer-list" id="clerk-list" style="max-height:170px;"></div>' +
        "</div>" +
        '<div class="flyer-opt" style="cursor:default;">' +
        "  <h4>" + bi("[२] नाव, हुद्दा व बकल नंबर", "[2] Name, rank and buckle number") + "</h4>" +
        '  <div class="flyer-mini-form">' +
        '   <input id="lg-name" placeholder="' + (isEnLang() ? "Full name" : "पूर्ण नाव") + '" aria-label="नाव / name">' +
        '   <select id="lg-rank" aria-label="हुद्दा / rank"></select>' +
        '   <input id="lg-buckle" placeholder="' + (isEnLang() ? "Buckle number" : "बकल नंबर") + '" aria-label="बकल नंबर" inputmode="numeric">' +
        '   <button type="button" class="flyer-btn-submit" id="lg-save">' + bi("लॉगिन करा", "Sign in") + "</button>" +
        (cur ? '   <button type="button" class="flyer-btn-danger" id="lg-out">' + bi("बाहेर पडा", "Sign out") + "</button>" : "") +
        "  </div>" +
        "</div>";
      var rankSel = document.getElementById("lg-rank");
      (m.ranks || []).forEach(function (r) {
        rankSel.appendChild(el("option", { value: r.rank_code }, esc(r.name_mr)));
      });
      function syncBuckle() {
        var applies = buckleApplies(rankSel.value);
        document.getElementById("lg-buckle").style.display = applies ? "" : "none";
      }
      rankSel.addEventListener("change", syncBuckle);
      function fill(p) {
        document.getElementById("lg-name").value = p.nameMr || "";
        if (p.rankCode) rankSel.value = p.rankCode;
        document.getElementById("lg-buckle").value = p.buckleNo || "";
        syncBuckle();
      }
      var list = document.getElementById("clerk-list");
      if (!cands.length) {
        list.innerHTML = '<div style="padding:8px; color:#94a3b8; font-size:11px;">'
          + bi("या तक्त्यावर हजेरी लेखनिक नोंद नाही — खाली नाव भरा.", "No clerk is recorded on this chart — fill the form below.") + "</div>";
      } else {
        cands.forEach(function (p) {
          // compact chart-name form, exactly as the chart prints it (rank + buckle + name)
          var label = mrDigits((p.rankShortFormMr || rankShort(p.rankCode)) +
            (p.buckleNo ? " " + p.buckleNo : "") + " " + (p.nameMr || ""));
          var item = el("div", { class: "flyer-item", tabindex: "0", role: "option" }, esc(label));
          var go = function () { fill(p); };
          item.addEventListener("click", go);
          item.addEventListener("keydown", function (e) {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); }
          });
          list.appendChild(item);
        });
        fill(cands[0]);
      }
      if (cur) fill(cur);
      syncBuckle();
      var outBtn = document.getElementById("lg-out");
      if (outBtn) outBtn.addEventListener("click", function () { setClerk(null); closeFlyer(); toast("लॉगआउट झाले", "ok"); });
      document.getElementById("lg-save").addEventListener("click", function () {
        var name = (document.getElementById("lg-name").value || "").trim();
        if (!name) { toast(isEnLang() ? "Please enter a name" : "कृपया नाव प्रविष्ट करा", "err"); return; }
        var rc = rankSel.value;
        var buckle = (document.getElementById("lg-buckle").value || "").trim();
        setClerk({
          staffId: null, nameMr: name, rankCode: rc, rankShort: rankShort(rc),
          buckleNo: buckleApplies(rc) ? (buckle || null) : null,
        });
        closeFlyer();
        paintClerkValues();
        toast("लॉगिन: " + clerkLabel(getClerk()), "ok");
      });
      openFlyerShell(isEnLang() ? "Clerk sign-in" : "हजेरी लेखनिक लॉगिन");
    }).catch(function (e) {
      busy = false;
      toast("लॉगिन उघडता आले नाही: " + e.message, "err");
    });
  }

  // ---------- header: language toggle + grouped nav ---------------------------
  // One UI language at a time: the markup ships both, CSS shows one, the choice persists in
  // localStorage. The CHART itself is police data and always prints Marathi — this only
  // switches the application chrome, never a rendered chart value.
  function applyLang(mode) {
    var en = mode === "en";
    document.body.classList.toggle("lang-en", en);
    document.body.classList.toggle("lang-mr", !en);
    try { localStorage.setItem("pd_lang", en ? "en" : "mr"); } catch (e) { /* private mode */ }
    Array.prototype.forEach.call(document.querySelectorAll("[data-lang-set]"), function (b) {
      b.classList.toggle("on", b.getAttribute("data-lang-set") === (en ? "en" : "mr"));
    });
  }
  function isEnLang() { return document.body.classList.contains("lang-en"); }
  function initLang() {
    var saved = "mr";
    try { saved = localStorage.getItem("pd_lang") || "mr"; } catch (e) { /* private mode */ }
    applyLang(saved);
  }
  function initNav() {
    document.addEventListener("click", function (e) {
      var langBtn = e.target.closest && e.target.closest("[data-lang-set]");
      if (langBtn) { applyLang(langBtn.getAttribute("data-lang-set")); return; }
      // Anything not built yet is VISIBLE and explorable, but says so honestly instead of
      // pretending to work (never a half-usable control, never a silent dead link).
      var wip = e.target.closest && e.target.closest("[data-wip]");
      if (wip) {
        e.preventDefault();
        openWip(wip.getAttribute("data-wip"));
        return;
      }
      // Master data is REAL and already in the database (ranks, staff, chowkis, duties, units) —
      // so the menu opens the actual rows instead of a "coming soon" badge (user 2026-10-13).
      var masters = e.target.closest && e.target.closest("[data-masters]");
      if (masters) {
        e.preventDefault();
        openMasters();
        return;
      }
      var legacy = e.target.closest && e.target.closest("[data-legacy]");
      if (legacy) {
        e.preventDefault();
        openLegacy();
        return;
      }
      var groupBtn = e.target.closest && e.target.closest(".ab-gbtn");
      var openGroups = document.querySelectorAll(".ab-group.open");
      if (groupBtn) {
        var wasOpen = groupBtn.parentNode.classList.contains("open");
        Array.prototype.forEach.call(openGroups, function (g) {
          g.classList.remove("open");
          g.querySelector(".ab-gbtn").setAttribute("aria-expanded", "false");
        });
        if (!wasOpen) {
          groupBtn.parentNode.classList.add("open");
          groupBtn.setAttribute("aria-expanded", "true");
        }
        return;
      }
      if (!(e.target.closest && e.target.closest(".ab-group"))) {
        Array.prototype.forEach.call(openGroups, function (g) { g.classList.remove("open"); });
      }
    });
  }

  // ---------- presentation controls (align / hide / compact) --------------------
  // The server contract shipped first (PATCH /api/charts/:date/presentation + ~190 elements
  // carrying data-presentation). The controls now live INSIDE the element's own edit flyer — no
  // floating mode, no standalone button (user correction 2026-10-13: the लेआउट button only worked
  // with edit mode on and could not be left). Hidden elements are listed in a restore bar for as
  // long as edit mode is on, so hiding is never a one-way door.
  var pvKey = null;
  function closePvPanel() { var p = document.getElementById("pv-panel"); if (p) p.remove(); }
  function pvPatch(body) {
    if (busy) return;
    busy = true;
    api("/api/charts/" + DATE + "/presentation", { method: "PATCH", body: JSON.stringify(body) })
      .then(function () { busy = false; closePvPanel(); closeFlyer(); reloadSoon(400, "✓ स्वरूप जतन झाला"); })
      .catch(function (e) { busy = false; toast("स्वरूप जतन अयशस्वी: " + e.message, "err"); });
  }
  function pvRowsHtml(el) {
    var h = el.getAttribute("data-horizontal-align") || "";
    var v = el.getAttribute("data-vertical-align") || "";
    var compact = el.getAttribute("data-compact") === "true";
    var row = function (field, list, cur) {
      return '<div class="pv-row" data-pv-field="' + field + '">' + list.map(function (o) {
        return '<button type="button" class="pv-b' + (cur === o[0] ? " on" : "") + '" data-pv-val="' + o[0] + '">' + o[1] + "</button>";
      }).join("") + "</div>";
    };
    return row("horizontalAlign", [["left", "डावी"], ["center", "मध्ये"], ["right", "उजवी"]], h)
      + row("verticalAlign", [["top", "वर"], ["middle", "मध्ये"], ["bottom", "खाली"]], v)
      + '<div class="pv-row">'
      + '<button type="button" class="pv-b' + (compact ? " on" : "") + '" data-pv-flag="compact">कॉम्पॅक्ट</button>'
      + '<button type="button" class="pv-b" data-pv-flag="hidden">लपवा</button>'
      + '<button type="button" class="pv-b pv-clear" data-pv-clear="1">पूर्ववत करा</button></div>';
  }
  function pvSectionHtml(el) {
    return '<div class="flyer-opt" style="cursor:default;">'
      + "<h4>स्वरूप — स्थान, कॉम्पॅक्टनेस व लपवणे</h4>"
      + '<div class="pv-block" data-pv-for="' + esc(el.getAttribute("data-presentation") || "") + '">'
      + pvRowsHtml(el) + "</div></div>";
  }
  function wirePvControls(scope, key) {
    var block = scope.querySelector("[data-pv-for]");
    if (!block) return;
    block.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest(".pv-b");
      if (!b) return;
      e.preventDefault();
      if (b.hasAttribute("data-pv-clear")) {
        pvPatch({ key: key, horizontalAlign: null, verticalAlign: null, hidden: null, compact: null });
      } else if (b.hasAttribute("data-pv-val")) {
        var patch = { key: key };
        patch[b.parentNode.getAttribute("data-pv-field")] = b.getAttribute("data-pv-val");
        pvPatch(patch);
      } else {
        var p2 = { key: key };
        p2[b.getAttribute("data-pv-flag")] = true;
        pvPatch(p2);
      }
    });
  }
  function renderHiddenBar() {
    var old = document.getElementById("pv-hidden");
    if (old) old.remove();
    api("/api/charts/" + DATE).then(function (doc) {
      if (!isEdit()) return;
      var ov = (doc.template && doc.template.overrides && doc.template.overrides.elements) || {};
      var hidden = Object.keys(ov).filter(function (k) { return ov[k] && ov[k].hidden === true; });
      if (!hidden.length) return;
      var bar = document.createElement("div");
      bar.id = "pv-hidden";
      bar.innerHTML = '<span class="pvh-t">लपवलेले घटक</span>' + hidden.map(function (k) {
        return '<button type="button" class="pv-b" data-pv-show="' + esc(k) + '" title="परत दाखवा">' + esc(k) + '</button>';
      }).join("");
      document.body.appendChild(bar);
    }).catch(function () { /* chrome only — never blocks the chart */ });
  }
  function openPvPanel(el) {
    closePvPanel();
    pvKey = el.getAttribute("data-presentation");
    if (!pvKey) return;
    var h = el.getAttribute("data-horizontal-align") || "";
    var v = el.getAttribute("data-vertical-align") || "";
    var compact = el.getAttribute("data-compact") === "true";
    var row = function (field, list, cur) {
      return '<div class="pv-row" data-pv-field="' + field + '">' + list.map(function (o) {
        return '<button type="button" class="pv-b' + (cur === o[0] ? " on" : "") + '" data-pv-val="' + o[0] + '">' + o[1] + "</button>";
      }).join("") + "</div>";
    };
    var p = document.createElement("div");
    p.id = "pv-panel";
    p.innerHTML = '<div class="pv-t">स्वरूप</div><div class="pv-k">' + esc(pvKey) + "</div>"
      + row("horizontalAlign", [["left", "डावी"], ["center", "मध्ये"], ["right", "उजवी"]], h)
      + row("verticalAlign", [["top", "वर"], ["middle", "मध्ये"], ["bottom", "खाली"]], v)
      + '<div class="pv-row">'
      + '<button type="button" class="pv-b" data-pv-flag="hidden">लपवा</button>'
      + '<button type="button" class="pv-b' + (compact ? " on" : "") + '" data-pv-flag="compact">कॉम्पॅक्ट</button>'
      + '<button type="button" class="pv-b pv-x" data-pv-close="1">✕</button></div>';
    document.body.appendChild(p);
    var r = el.getBoundingClientRect();
    p.style.left = Math.max(8, Math.min(window.innerWidth - 248, r.left)) + "px";
    p.style.top = Math.round(r.bottom + window.pageYOffset + 6) + "px";
  }
  function initPresentation() {
    // The restore bar follows edit mode — there is no separate layout mode any more.
    if (!("MutationObserver" in window)) return;
    new MutationObserver(function () {
      if (document.body.classList.contains("mode-edit")) renderHiddenBar();
      else { var b = document.getElementById("pv-hidden"); if (b) b.remove(); }
    }).observe(document.body, { attributes: true, attributeFilter: ["class"] });
    if (document.body.classList.contains("mode-edit")) renderHiddenBar();
    document.addEventListener("click", function (e) {
      var show = e.target.closest && e.target.closest("[data-pv-show]");
      if (!show) return;
      e.stopPropagation();
      pvPatch({ key: show.getAttribute("data-pv-show"), hidden: null });
    });
  }

  // ---------- master data (REAL rows, read-only) -------------------------------
  // The station already HAS this data — ranks, staff, chowkis, duties, units — so the menu shows
  // the actual rows instead of a "coming soon" badge (user 2026-10-13: "at least what is in our
  // master data or DB currently should be visible"). Editing/creating new masters beyond the
  // staff the assignment flow already creates stays a labelled WIP item; nothing here writes.
  function openMasters() {
    if (busy) return;
    ensureFlyer();
    var body = document.getElementById("flyer-body");
    body.innerHTML = '<div class="flyer-slot-info">डेटाबेसमधील प्रत्यक्ष नोंदी — फक्त पाहण्यासाठी</div>'
      + '<div class="flyer-opt" style="cursor:default;"><div id="md-out">लोड होत आहे…</div></div>';
    openFlyerShell("मास्टर डेटा");
    loadMasters().then(function (m) {
      var out = document.getElementById("md-out");
      if (!out) return;
      var staffRows = (m.staff || []).map(function (s) {
        return '<tr data-md-name="' + esc((s.name_mr || "") + " " + (s.name_en || "") + " " + (s.buckle_no || "")) + '">'
          + '<td>' + esc(rankShort(s.rank_code)) + '</td>'
          + '<td>' + esc(s.buckle_no || "—") + '</td>'
          + '<td>' + esc(s.name_mr || "") + (s.name_en ? ' <span class="md-en">' + esc(s.name_en) + "</span>" : "")
          + (s.active === false ? ' <span class="md-off">निष्क्रिय</span>' : "") + "</td></tr>";
      }).join("");
      out.innerHTML =
        '<div class="md-counts">'
        + '<span>कर्मचारी <b>' + (m.staff || []).length + '</b></span>'
        + '<span>चौक्या/ठिकाणे <b>' + (m.locations || []).length + '</b></span>'
        + '<span>कर्तव्ये <b>' + (m.duties || []).length + '</b></span>'
        + '<span>हुद्दे <b>' + (m.ranks || []).length + '</b></span>'
        + '<span>घटक <b>' + (m.units || []).length + '</b></span></div>'
        + '<h4>कर्मचारी मास्टर</h4>'
        + '<input type="search" id="md-search" class="flyer-search" placeholder="नाव / बकल / हुद्दा शोधा" aria-label="मास्टर डेटा शोधा">'
        + '<div class="md-scroll"><table class="md-tbl"><thead><tr><th>हुद्दा</th><th>बकल</th><th>नाव</th></tr></thead><tbody id="md-staff">' + staffRows + "</tbody></table></div>"
        + '<h4>चौक्या व ठिकाणे</h4>'
        + '<div class="md-tags">' + (m.locations || []).map(function (l) {
          return '<span class="md-tag">' + esc(l.name_mr) + " <i>" + esc(l.kind || "") + "</i></span>";
        }).join("") + "</div>"
        + '<h4>कर्तव्ये</h4>'
        + '<div class="md-tags">' + (m.duties || []).map(function (d) {
          return '<span class="md-tag">' + esc(d.title_mr) + " <i>" + esc(d.duty_code) + "</i></span>";
        }).join("") + "</div>"
        + '<p class="wip-note">हे सगळे डेटाबेसमधील खरे मास्टर आहेत (PostgreSQL). नवीन नोंदी जोडणे, OCR/दस्तऐवज आयात व मास्टर संपादनाची पूर्ण पाने अजून तयार नाहीत — तोपर्यंत ती कर्मचारी निवडण्याच्या ठिकाणी (नवीन कर्मचारी जोडा / माहिती बदला) आणि याच पडद्यावर वाचता येतात.</p>';
      var search = document.getElementById("md-search");
      search.addEventListener("input", function () {
        var q = search.value.trim().toLowerCase();
        var rows = document.querySelectorAll("#md-staff tr");
        Array.prototype.forEach.call(rows, function (r) {
          var hay = (r.getAttribute("data-md-name") || "").toLowerCase();
          r.hidden = q !== "" && hay.indexOf(q) < 0;
        });
      });
    });
  }

  // ---------- legacy six-page chart (Kushal's repo) — a separate local app -------
  // User 2026-10-13: the legacy chart is the ACTUAL six-page chart implemented in Kushal's repo
  // (src/web/Page1View…Page6View.tsx), not a design mock. That app has its own database
  // (panchavati_dev), its own API shape and root-absolute assets, so it is shown in its own tab
  // at its own origin instead of being re-implemented or proxied (a proxy would render a broken
  // shell). `npm run legacy:start` starts it; this flyer probes it first and says plainly when it
  // is not running — never a dead link and never a pretend chart.
  // Same-origin by design: the server's /legacy/<date> route redirects to the legacy app (which
  // keeps :3101 because this repo's own chart server owns :3100). No absolute URL in the browser
  // code — that is both the local-only invariant and one fewer thing to get wrong.
  // TWO reference builds can run side by side (user 2026-10-13: “I guess we can have both running
  // for reference”): Kushal's build loads the data into the real six-page chart, the other one is
  // the earlier showcase build. Both keep their own database; `npm run demo` starts ours plus both
  // of them, `npm run legacy:start` starts the first alone. Only same-origin /legacy… URLs are used
  // here (the server owns the other app's origin), and each is PROBED before it is offered.
  var LEGACY_TARGETS = [
    { key: "kushal", url: "/legacy/" + DATE, label: "कुशल — डेटासह जुना ६-पृष्ठ तक्ता", port: "३१०१", cmd: "npm run legacy:start", embed: true },
    { key: "arjish", url: "/legacy2/" + DATE, label: "अर्जिश — संदर्भ ६-पृष्ठ तक्ता", port: "३१०२", cmd: "npm run legacy:start:arjish", embed: false }
  ];
  function legacyProbe(url, cb) {
    var done = false;
    var finish = function (up) { if (!done) { done = true; cb(up); } };
    setTimeout(function () { finish(false); }, 2500);
    // opaque no-cors request: resolves when SOMETHING answers, rejects when nothing is listening.
    try {
      fetch(url, { mode: "no-cors", cache: "no-store" })
        .then(function () { finish(true); }, function () { finish(false); });
    } catch (e) { finish(false); }
  }
  function openLegacy() {
    ensureFlyer();
    var body = document.getElementById("flyer-body");
    body.innerHTML = '<div class="flyer-slot-info">जुना ६-पृष्ठ तक्ता — १० सप्टेंबर २०२६</div>'
      + '<div class="flyer-opt" style="cursor:default;">'
      + "<h4>दोन स्वतंत्र संदर्भ अ‍ॅप (प्रत्येकाचा स्वतःचा डेटाबेस)</h4>"
      + '<p class="wip-note">ही सहा-पृष्ठ तक्त्याची जुनी अ‍ॅप्स आहेत — स्वतंत्र डेटाबेस व स्वतःचे API. फक्त तुलनेसाठी इथे उघडतात; त्यांचे बदल या तक्त्यावर परिणाम करत नाहीत. एकत्र चालवण्यासाठी: <b>npm run demo</b>.</p>'
      + LEGACY_TARGETS.map(function (targ) {
        return '<div class="lg-card" id="lg-card-' + targ.key + '">'
          + '<div class="lg-row"><b>' + esc(targ.label) + '</b><span class="lg-status" id="lg-st-' + targ.key + '">तपासत आहे…</span></div>'
          + '<div id="lg-body-' + targ.key + '"></div></div>';
      }).join("")
      + "</div>";
    openFlyerShell("जुना ६-पृष्ठ तक्ता");
    LEGACY_TARGETS.forEach(function (targ) { paintLegacy(targ); });
  }
  function paintLegacy(targ) {
    legacyProbe(targ.url, function (up) {
      var st = document.getElementById("lg-st-" + targ.key);
      var host = document.getElementById("lg-body-" + targ.key);
      if (!st || !host) return;
      if (up) {
        st.className = "lg-status on";
        st.textContent = "चालू आहे (पोर्ट " + targ.port + ")";
        host.innerHTML = '<iframe class="lg-frame' + (targ.embed ? "" : " short") + '" src="' + esc(targ.url) + '" title="' + esc(targ.label) + '" loading="lazy"></iframe>'
          + '<div class="lg-actions"><button type="button" class="flyer-btn-submit" id="lg-open-' + targ.key + '">नवीन टॅबमध्ये उघडा</button></div>';
        document.getElementById("lg-open-" + targ.key).addEventListener("click", function () {
          window.open(targ.url, "_blank", "noopener");
        });
      } else {
        st.className = "lg-status off";
        st.textContent = "बंद आहे — सध्या चालू नाही";
        host.innerHTML = '<p class="wip-note">उघडण्यासाठी एकदा चालवा:</p><p class="lg-cmd">' + esc(targ.cmd) + "</p>"
          + '<div class="lg-actions"><button type="button" class="flyer-btn-ghost" id="lg-retry-' + targ.key + '">पुन्हा तपासा</button></div>';
        document.getElementById("lg-retry-" + targ.key).addEventListener("click", function () {
          st.className = "lg-status";
          st.textContent = "तपासत आहे…";
          host.innerHTML = "";
          paintLegacy(targ);
        });
      }
    });
  }

  // ---------- WIP leaves: visible AND explorable ------------------------------
  // A planned feature opens its own honest placeholder page (never a dead link, never a
  // half-usable control). It says plainly that the feature is not built yet and what it will
  // hold, so the older Arjish/Kushal pages stay discoverable exactly as the user asked.
  function openWip(name) {
    ensureFlyer();
    document.getElementById("flyer-body").innerHTML =
      '<div class="flyer-slot-info"><span data-lang="mr">' + esc(name) + ' — येणारे वैशिष्ट्य</span><span data-lang="en">' + esc(name) + ' — planned feature</span></div>' +
      '<div class="flyer-opt" style="cursor:default;">' +
      '  <h4><span data-lang="mr">सध्याची स्थिती</span><span data-lang="en">Current status</span></h4>' +
      '  <p class="wip-note"><span data-lang="mr">हे वैशिष्ट्य अजून तयार नाही. मेनूमध्ये दिले आहे म्हणूनच पाहता येते — बिना तयार असलेल्या पानावर क्लिक करून काम चालू करता येणार नाही.</span><span data-lang="en">This feature is not built yet. It is listed so you can see what is planned — clicking a page that does not exist will never start work.</span></p>' +
      '  <p class="wip-note"><span data-lang="mr"><b>प्लॅन:</b> तक्ता पाहणे व बदल जतन, कर्मचारी/चौक्या/हुद्द्यांचा मास्टर डेटा, जुन्या तक्त्यांचा संदर्भ व प्रतवारी, OCR आयात, व WhatsApp/Telegram शेअरिंग — सर्व केवळ स्थानिक डेटावर, कोणताही बाहेरील कॉल नाही.</b></span><span data-lang="en"><b>Planned:</b> chart viewing and saving edits, master data for staff/chowkis/duties, historical reference and comparison, OCR import, and WhatsApp/Telegram sharing — all local only, no external calls.</span></p>' +
      '  <div class="flyer-mini-form"><button type="button" class="flyer-btn-submit" id="wip-ok"><span data-lang="mr">समजले</span><span data-lang="en">Got it</span></button></div>' +
      "</div>";
    document.getElementById("wip-ok").addEventListener("click", closeFlyer);
    openFlyerShell(name + " (WIP)");
  }

  // ---------- boot ------------------------------------------------------------
  if (!DATE) return; // not a chart page (or static render without server)
  initLang();
  initNav();
  initPresentation();
  var modeBtn = document.getElementById("mode-btn");
  if (modeBtn) modeBtn.addEventListener("click", function () { setMode(!isEdit()); });
  var finBtn = document.getElementById("finalize-btn");
  if (finBtn) finBtn.addEventListener("click", finalizeChart);
  var amendBtn = document.getElementById("amend-btn");
  if (amendBtn) amendBtn.addEventListener("click", reopenChart);
  initDateMenu();
  initAbbrTip();
  paintClerk();
  paintClerkValues();
  var userBtn = document.getElementById("ab-user");
  if (userBtn) {
    userBtn.addEventListener("click", function (e) { e.stopPropagation(); openLogin(); });
    loadMasters().then(paintClerk);   // rank short forms for the chip label
  }

  var restored = false;
  try { restored = sessionStorage.getItem("pd_mode") === "edit"; } catch (e) { /* ignore */ }
  if (restored && LIFECYCLE !== "FINALIZED") setMode(true);
  try {
    var pending = sessionStorage.getItem("pd_toast");
    if (pending) {
      sessionStorage.removeItem("pd_toast");
      setTimeout(function () { toast(pending, "ok"); }, 150);
    }
  } catch (e) { /* ignore */ }

  document.addEventListener("click", onDocumentClick);
  document.addEventListener("change", onDocumentChange);
  document.addEventListener("keydown", onDocumentKeydown);
})();
