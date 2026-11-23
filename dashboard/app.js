// The dashboard for the token radar, v2: a fresh implementation of the same page.
//
// It reads window.RADAR (written beside dashboard/ by main.ts) and renders the ranked board, a
// filterable table, a live-token view, the model's formula, and a per-protocol detail dialog with
// the model's inputs and the farm plan. No network: every byte shown is already in data.js.
//
// The page also checks its own arithmetic: the detail dialog recomputes a row's implied value
// from the snapshot figures and says whether it matches the number board.json carries.

(function () {
  'use strict';

  var RADAR = window.RADAR;
  if (!RADAR) return;
  var board = document.getElementById('board');
  var view = { q: '', category: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  function money(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return dollars.format(n);
  }

  function pct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }

  function ageLabel(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }

  // The page recomputes a row from the snapshot figures, with the same arithmetic the model used,
  // so the dialog can say whether the page and the board agree on the number.
  function recompute(row, model) {
    var growth = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    growth = Math.min(model.growth_cap, Math.max(model.growth_floor, growth));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    return Math.max(1, Math.round(row.tvl_usd * row.multiple * growthMult * maturity));
  }

  // A small element builder: tag('div', {class: 'x', text: 'y'}, child, ...) returns the node.
  function tag(name, attrs) {
    var node = document.createElement(name);
    if (attrs) {
      for (var key in attrs) {
        var value = attrs[key];
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key === 'html') node.innerHTML = value;
        else if (key.slice(0, 2) === 'on') node.addEventListener(key.slice(2), value);
        else if (value !== null && value !== undefined) node.setAttribute(key, value);
      }
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) {
        for (var j = 0; j < child.length; j++) if (child[j]) node.appendChild(child[j]);
      } else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation the model writes to board.json: category, chains, TVL
  // and age decide the action, the capital, the hold and every cost and time. No name is special-cased.
  function chainName(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }

  function capitalNeeded(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }

  function holdNeeded(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }

  function gasPrice(chain) {
    var cheap = ['Base', 'Arbitrum', 'Optimism', 'Solana', 'Polygon', 'BSC', 'BNB Chain', 'Blast', 'Linea', 'Scroll', 'zkSync Era', 'Mantle', 'Mode', 'Avalanche'];
    if (cheap.indexOf(chain) >= 0) return { perTx: 'about $0.50 of gas', weekly: 'about $0.50 of gas a week' };
    if (chain === 'Ethereum') return { perTx: 'about $8 of gas', weekly: 'about $8 of gas a week' };
    return { perTx: 'about $2 of gas', weekly: 'about $2 of gas a week' };
  }

  function planAction(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('risk') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    if (c.indexOf('liquid') >= 0) return 'Deposit $' + capital + ' of the liquid asset into ' + name + ' on ' + chain + ' and keep the receipt.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }

  function planText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }

  function planSteps(p) {
    var chain = chainName(p);
    var capital = capitalNeeded(p);
    var hold = holdNeeded(p.age_days);
    var gas = gasPrice(chain);
    var listed = p.listed_at ? 'listed ' + p.listed_at : 'with no listing date on record';
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: planAction(p, capital, chain), cost: '$' + capital + ' of capital and ' + gas.perTx, time: '15 minutes to set up' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote, and keep doing it while ' + p.name + ' runs ' + listed + '.', cost: gas.weekly, time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Open the protocol's own points or rewards page once a week and check that your wallet's activity is showing.", cost: 'no fee to check', time: '5 minutes a week' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(planText);
  }

  function hashIn() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) view.q = params.get('q');
    if (params.get('p')) view.selected = params.get('p');
    if (params.get('category')) view.category = params.get('category');
  }

  function hashOut() {
    var params = new URLSearchParams();
    if (view.q) params.set('q', view.q);
    if (view.category !== 'all') params.set('category', view.category);
    if (view.selected) params.set('p', view.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function visibleRows() {
    var q = view.q.trim().toLowerCase();
    return RADAR.rows.filter(function (r) {
      if (view.category !== 'all' && r.category !== view.category) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }

  function orderedRows(list) {
    var key = view.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -view.dir;
      if (av > bv) return view.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function topBar() {
    return tag('header', { class: 'top' },
      tag('div', { class: 'brand' }, tag('span', { class: 'mark' }), tag('span', { class: 'brand-name', text: 'Token Radar' })),
      tag('div', { class: 'top-meta' },
        tag('span', { text: 'Snapshot ' + RADAR.as_of }),
        tag('span', { text: 'DefiLlama protocol index' }),
        tag('span', { text: RADAR.model_version + ' model' })
      )
    );
  }

  function intro() {
    return tag('section', { class: 'lede' },
      tag('div', null,
        tag('h1', { text: RADAR.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        tag('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(RADAR.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + RADAR.early_size + ' more pre-token protocols the watchlist’s own rule would keep, at any TVL. Wrapped, staked and bridged products are set aside: their token already trades. Implied value is a model, not a promise.' })
      ),
      tag('div', { class: 'facts' },
        tag('div', { class: 'fact' }, tag('span', { text: 'Watchlist covered' }), tag('b', { text: RADAR.watchlist_size + ' / ' + RADAR.watchlist_size })),
        tag('div', { class: 'fact' }, tag('span', { text: 'Pre-token rows scored' }), tag('b', { text: String(RADAR.board_size) })),
        tag('div', { class: 'fact' }, tag('span', { text: 'Early rows at any TVL' }), tag('b', { text: String(RADAR.early_size) })),
        tag('div', { class: 'fact' }, tag('span', { text: 'Wrapped / staked / bridged set aside' }), tag('b', { text: String(RADAR.calibration.excluded_count) })),
        tag('div', { class: 'fact' }, tag('span', { text: 'Live-token protocols set aside' }), tag('b', { text: String(RADAR.live_size) }))
      )
    );
  }

  function filterBar() {
    var categories = Array.from(new Set(RADAR.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var search = tag('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: view.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { view.q = search.value; hashOut(); paint(); });
    var select = tag('select', { id: 'category', 'aria-label': 'Filter by category' },
      tag('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return tag('option', { value: c, text: c, selected: c === view.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { view.category = select.value; hashOut(); paint(); });
    var pre = tag('button', { type: 'button', 'aria-pressed': view.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { view.tab = 'pre-token'; paint(); } });
    var live = tag('button', { type: 'button', 'aria-pressed': view.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { view.tab = 'live'; paint(); } });
    return tag('div', { class: 'controls' },
      tag('div', { class: 'field' }, tag('label', { for: 'q', text: 'Search' }), search),
      tag('div', { class: 'field' }, tag('label', { for: 'category', text: 'Category' }), select),
      tag('div', { class: 'field' }, tag('span', { class: 'sub', text: 'Token status' }), tag('div', { class: 'tabs' }, pre, live)),
      tag('span', { class: 'count', text: view.tab === 'pre-token' ? visibleRows().length + ' rows shown' : RADAR.live.length + ' live-token protocols' })
    );
  }

  function sortHead(key, label) {
    return tag('th', { scope: 'col' },
      tag('button', { type: 'button', onclick: function () { if (view.sort === key) view.dir = -view.dir; else { view.sort = key; view.dir = -1; } paint(); } },
        label,
        view.sort === key ? tag('span', { 'aria-hidden': 'true', text: view.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function preTable() {
    var list = orderedRows(visibleRows());
    if (list.length === 0) {
      return tag('div', { class: 'panel' }, tag('div', { class: 'empty' },
        tag('h2', { text: 'No protocol matches that filter' }),
        tag('p', { text: 'Clear the search or pick another category to see the board again.' }),
        tag('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { view.q = ''; view.category = 'all'; hashOut(); paint(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = tag('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : pct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = tag('tr', {
        'data-selected': view.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { showProtocol(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showProtocol(r.slug); } }
      },
        tag('td', { class: 'num', text: String(r.rank) }),
        tag('td', null, tag('div', { class: 'name' },
          tag('b', { text: r.name }),
          r.watchlist ? tag('span', { class: 'badge', text: 'watchlist' }) : null,
          tag('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        tag('td', { class: 'num', text: money(r.tvl_usd) }),
        tag('td', { class: 'num ' + growthClass, text: growth }),
        tag('td', { class: 'num', text: ageLabel(r.age_days) }),
        tag('td', null, tag('div', { class: 'implied' },
          tag('div', { class: 'bar', 'aria-hidden': 'true' }, tag('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          tag('span', { class: 'num', text: money(r.implied_value_usd) })
        )),
        tag('td', null, tag('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return tag('div', { class: 'panel' },
      tag('div', { class: 'table-wrap' },
        tag('table', null,
          tag('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          tag('thead', null, tag('tr', null,
            sortHead('implied', 'Rank'),
            sortHead('name', 'Protocol'),
            sortHead('tvl', 'TVL'),
            sortHead('growth', '7d'),
            sortHead('age', 'Age'),
            sortHead('implied', 'Implied value'),
            tag('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = tag('tbody');
    RADAR.live.forEach(function (r) {
      tbody.appendChild(tag('tr', null,
        tag('td', { class: 'num', text: 'live' }),
        tag('td', null, tag('div', { class: 'name' }, tag('b', { text: r.name }), tag('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        tag('td', { class: 'num', text: money(r.tvl_usd) }),
        tag('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: pct(r.change_7d) }),
        tag('td', { class: 'num', text: money(r.mcap_usd) }),
        tag('td', null, tag('span', { class: 'status', text: 'already trades' }))
      ));
    });
    return tag('div', { class: 'panel' },
      tag('div', { class: 'table-wrap' },
        tag('table', null,
          tag('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          tag('thead', null, tag('tr', null, tag('th', { scope: 'col', text: 'Status' }), tag('th', { scope: 'col', text: 'Protocol' }), tag('th', { scope: 'col', text: 'TVL' }), tag('th', { scope: 'col', text: '7d' }), tag('th', { scope: 'col', text: 'Market cap' }), tag('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelBox() {
    var m = RADAR.model;
    var c = RADAR.calibration;
    var mults = Object.keys(c.category_multiples).sort().map(function (k) { return k + ' ' + c.category_multiples[k]; });
    return tag('section', { class: 'panel model' },
      tag('h2', { text: 'How implied value is computed' }),
      tag('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      tag('div', { class: 'formula' },
        'implied = round( tvl_usd x multiple(category) x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') )'
      ),
      tag('p', { class: 'sub', text: 'The multiple is read off the market, not chosen: for each category, the median market-cap / TVL ratio of the ' + c.live_sample + ' live-token protocols in that category, winsorized to [' + m.multiple_floor + ', ' + m.multiple_cap + ']; a category with fewer than ' + m.min_category_sample + ' live protocols uses the snapshot-wide median of ' + c.global_median + '. Category multiples: ' + mults.join(', ') + '.' }),
      tag('p', { class: 'sub', text: 'TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. ' + c.excluded_count + ' pre-token protocols are set aside as wrapped, staked or bridged products of a token that already trades, and the live-token protocols are shown with their market caps.' })
    );
  }

  var dialog = tag('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { view.selected = null; hashOut(); });

  function showProtocol(slug) {
    var row = RADAR.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    view.selected = slug;
    hashOut();
    dialog.textContent = '';
    var steps = planSteps(row);
    var recomputed = recompute(row, RADAR.model);
    dialog.appendChild(tag('div', { class: 'detail-head' },
      tag('div', null,
        tag('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + RADAR.board_size }),
        tag('h2', { id: 'detail-title', text: row.name }),
        tag('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      tag('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(tag('section', { class: 'detail-section' },
      tag('h3', { text: 'Implied value' }),
      tag('div', { class: 'equation' },
        tag('div', null, tag('span', { text: 'TVL' }), tag('b', { class: 'num', text: money(row.tvl_usd) })),
        tag('div', null, tag('span', { text: 'Category multiple (' + (row.category || 'Other') + ')' }), tag('b', { class: 'num', text: String(row.multiple) })),
        tag('div', null, tag('span', { text: 'Seven-day growth' }), tag('b', { class: 'num', text: pct(row.change_7d) })),
        tag('div', null, tag('span', { text: 'Age with no token' }), tag('b', { class: 'num', text: ageLabel(row.age_days) })),
        tag('div', null, tag('span', { text: 'Growth multiplier' }), tag('b', { class: 'num', text: String(row.growth_multiplier) })),
        tag('div', null, tag('span', { text: 'Maturity multiplier' }), tag('b', { class: 'num', text: String(row.maturity_multiplier) })),
        tag('div', null, tag('span', { text: 'Implied value' }), tag('b', { class: 'num', text: money(row.implied_value_usd) }))
      ),
      tag('p', { class: 'sub', text: 'Model ' + RADAR.model_version + ': the same function scores every protocol. The page recomputes this row as ' + money(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(tag('section', { class: 'detail-section' },
      tag('h3', { text: 'Farm plan' }),
      tag('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return tag('li', null, tag('b', { text: action }), tag('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function paint() {
    board.textContent = '';
    var shell = tag('div', { class: 'shell' });
    shell.appendChild(topBar());
    shell.appendChild(intro());
    shell.appendChild(filterBar());
    shell.appendChild(view.tab === 'pre-token' ? preTable() : liveTable());
    if (view.tab === 'pre-token') shell.appendChild(modelBox());
    board.appendChild(shell);
    board.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) board.appendChild(dialog);
    if (view.selected) showProtocol(view.selected);
  }

  hashIn();
  paint();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
