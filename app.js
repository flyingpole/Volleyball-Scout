const STORAGE_KEY = "volleyball_scout_v1";
const OLD_KEYS = [
  "vb_sr_attack_tracker_v12",
  "vb_sr_attack_tracker_v11",
  "vb_sr_attack_tracker_v10",
  "volleyballOpponentTracker_v1"
];

let state = {
  settings: {
    twoTeams: false,
    receive: true,
    attack: true,
    heat: true,
    haptics: true
  },
  teams: [
    { name: "Team", players: [] },
    { name: "Team 2", players: [] }
  ],
  history: []
};

let selectedScore = null;
let toastTimer = null;
let attackTapTimer = null;

const teamsEl = document.getElementById("teams");
const settingsPanel = document.getElementById("settingsPanel");
const scoreDialog = document.getElementById("scoreDialog");
const scoreChoices = document.getElementById("scoreChoices");
const dialogTitle = document.getElementById("dialogTitle");
const dialogMeta = document.getElementById("dialogMeta");
const rosterDialog = document.getElementById("rosterDialog");
const clearDialog = document.getElementById("clearDialog");
const rosterTitle = document.getElementById("rosterTitle");
const rosterList = document.getElementById("rosterList");
const undoToast = document.getElementById("undoToast");
const toastText = document.getElementById("toastText");
const pdfPanel = document.getElementById("pdfPanel");
const pdfOpenLink = document.getElementById("pdfOpenLink");
const pdfDownloadLink = document.getElementById("pdfDownloadLink");
const pdfCloseBtn = document.getElementById("pdfCloseBtn");

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      state = normalizeState(JSON.parse(raw));
      return;
    }

    for (const key of OLD_KEYS) {
      const old = localStorage.getItem(key);
      if (old) {
        state = migrateOldState(key, JSON.parse(old));
        save();
        return;
      }
    }
  } catch (error) {
    console.log("Load failed", error);
  }
}

function normalizeState(input) {
  const next = {
    settings: Object.assign({}, state.settings, input.settings || {}),
    teams: Array.isArray(input.teams) ? input.teams.slice(0, 2) : state.teams,
    history: Array.isArray(input.history) ? input.history : []
  };

  while (next.teams.length < 2) next.teams.push({ name: `Team ${next.teams.length + 1}`, players: [] });
  next.teams = next.teams.map((team, index) => ({
    name: team.name || (index === 0 ? "Team" : "Team 2"),
    players: Array.isArray(team.players) ? team.players.map(normalizePlayer) : []
  }));
  return next;
}

function normalizePlayer(player) {
  return {
    id: player.id || uid(),
    number: player.number || player.label || "",
    libero: !!(player.libero || player.isLibero),
    receive: Array.isArray(player.receive) ? player.receive.map(Number) : Array.isArray(player.scores) ? player.scores.map(Number) : [],
    attacks: Array.isArray(player.attacks) ? player.attacks : []
  };
}

function migrateOldState(key, old) {
  if (key === "volleyballOpponentTracker_v1") {
    const teams = (old.teams || [{ players: {} }, { players: {} }]).slice(0, 2).map((team, index) => ({
      name: old.teamNames?.[index] || (index === 0 ? "Team" : "Team 2"),
      players: Object.keys(team.players || {}).map(number => normalizePlayer({
        number,
        isLibero: team.players[number].isLibero,
        scores: team.players[number].scores
      }))
    }));
    return normalizeState({
      settings: { twoTeams: !!old.scoutingMode, receive: true, attack: false, heat: true, haptics: true },
      teams,
      history: []
    });
  }

  return normalizeState({
    settings: {
      twoTeams: !!old.twoTeams,
      receive: true,
      attack: true,
      heat: true,
      haptics: old.haptics !== false
    },
    teams: old.teams || state.teams,
    history: old.history || []
  });
}

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random());
}

function esc(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function label(value) {
  const text = String(value).trim();
  return /^\d+$/.test(text) ? `#${text}` : text;
}

function sortPlayers(players) {
  players.sort((a, b) => {
    if (a.libero !== b.libero) return a.libero ? -1 : 1;
    const av = String(a.number);
    const bv = String(b.number);
    const an = /^\d+$/.test(av);
    const bn = /^\d+$/.test(bv);
    if (an && bn) return Number(av) - Number(bv);
    if (an !== bn) return an ? -1 : 1;
    return av.localeCompare(bv, undefined, { numeric: true, sensitivity: "base" });
  });
}

function visibleTeams() {
  return state.settings.twoTeams ? state.teams : [state.teams[0]];
}

function findPlayer(teamIndex, playerId) {
  return state.teams[teamIndex]?.players.find(player => player.id === playerId);
}

function addPlayer(teamIndex, libero) {
  const input = document.getElementById(`playerInput${teamIndex}`);
  const number = input.value.trim();
  if (!number) return;

  const team = state.teams[teamIndex];
  const duplicate = team.players.some(player => String(player.number).toLowerCase() === number.toLowerCase());
  if (duplicate) {
    input.select();
    return;
  }

  team.players.push({ id: uid(), number, libero, receive: [], attacks: [] });
  sortPlayers(team.players);
  input.value = "";
  save();
  render();
  if (rosterDialog.open) openRoster(teamIndex);
}

function deletePlayer(teamIndex, playerId) {
  const player = findPlayer(teamIndex, playerId);
  if (!player) return;
  if (!confirm(`Remove ${label(player.number)} from ${state.teams[teamIndex].name || `Team ${teamIndex + 1}`}?`)) return;

  const reopenRoster = rosterDialog.open;
  if (reopenRoster) rosterDialog.close();
  state.teams[teamIndex].players = state.teams[teamIndex].players.filter(item => item.id !== playerId);
  state.history = state.history.filter(item => !(item.team === teamIndex && item.id === playerId));
  save();
  render();
  if (reopenRoster) openRoster(teamIndex);
}

function openRoster(teamIndex) {
  const team = state.teams[teamIndex];
  rosterTitle.textContent = `${team.name || `Team ${teamIndex + 1}`} Roster`;
  if (rosterDialog.open) rosterDialog.close();
  rosterList.innerHTML = `
    <div class="rosterAddRow">
      <input id="playerInput${teamIndex}" placeholder="Player # or name" inputmode="numeric" autocomplete="off" onkeydown="if(event.key==='Enter')addPlayer(${teamIndex}, false)">
      <button type="button" onclick="addPlayer(${teamIndex}, false)">Add<br>Player</button>
      <button type="button" class="libBtn" onclick="addPlayer(${teamIndex}, true)">Add<br>Libero</button>
    </div>
    ${team.players.length
      ? team.players.map(player => {
      const attacks = attackStats(player);
      return `
        <div class="rosterRow">
          <div class="rosterPlayer">
            ${esc(label(player.number))}
            <span class="rosterMeta">${player.libero ? "Libero" : "Player"} - SR ${player.receive.length} - ATT ${attacks.attempts}</span>
          </div>
          <button type="button" class="removePlayerBtn" onclick="deletePlayer(${teamIndex}, '${player.id}')">Remove</button>
        </div>
      `;
    }).join("")
      : `<div class="empty">No players on this roster.</div>`}
  `;
  rosterDialog.showModal();
  const input = document.getElementById(`playerInput${teamIndex}`);
  if (input) input.focus();
}

function openScore(type, teamIndex, playerId) {
  const player = findPlayer(teamIndex, playerId);
  if (!player) return;

  selectedScore = { type, team: teamIndex, id: playerId };
  dialogTitle.textContent = type === "receive" ? "Serve Receive" : "Attack";
  dialogMeta.textContent = `${state.teams[teamIndex].name || `Team ${teamIndex + 1}`} - ${label(player.number)}`;
  scoreChoices.className = `scoreChoices ${type}`;
  scoreChoices.innerHTML = "";

  const choices = type === "receive"
    ? [{ value: 0, text: "0" }, { value: 1, text: "1" }, { value: 2, text: "2" }, { value: 3, text: "3" }]
    : [
      { value: "T", text: "Tip Kill", className: "scoreTipKill" },
      { value: "t", text: "tip att", className: "scoreTipAttempt" },
      { value: "-", text: "Error", className: "scoreError" },
      { value: ".", text: "Attempt", className: "scoreAttempt" },
      { value: "+", text: "Kill", className: "scoreKill" }
    ];

  choices.forEach(choice => {
    const button = document.createElement("button");
    button.type = "button";
    if (choice.className) button.className = choice.className;
    button.textContent = choice.text;
    button.addEventListener("click", () => recordScore(choice.value));
    scoreChoices.appendChild(button);
  });

  scoreDialog.showModal();
}

function recordScore(value) {
  if (!selectedScore) return;
  recordScoreFor(selectedScore.type, selectedScore.team, selectedScore.id, value);
  scoreDialog.close();
}

function recordScoreFor(type, teamIndex, playerId, value) {
  const player = findPlayer(teamIndex, playerId);
  if (!player) return;

  if (type === "receive") {
    player.receive.push(Number(value));
  } else {
    player.attacks.push(String(value));
  }

  state.history.push({
    type,
    team: teamIndex,
    id: playerId,
    value
  });

  buzz(60);
  save();
  render();
  showUndoToast(`${label(player.number)} ${type === "receive" ? "SR" : "ATT"} ${value}`);
}

function handleAttackClick(teamIndex, playerId) {
  clearTimeout(attackTapTimer);
  attackTapTimer = setTimeout(() => {
    attackTapTimer = null;
    openScore("attack", teamIndex, playerId);
  }, 240);
}

function handleAttackDoubleClick(event, teamIndex, playerId) {
  event.preventDefault();
  clearTimeout(attackTapTimer);
  attackTapTimer = null;
  if (scoreDialog.open) scoreDialog.close();
  recordScoreFor("attack", teamIndex, playerId, ".");
}

function undoLast() {
  const last = state.history.pop();
  if (!last) return;
  const player = findPlayer(last.team, last.id);
  if (player) {
    if (last.type === "receive") player.receive.pop();
    if (last.type === "attack") player.attacks.pop();
  }
  buzz([30, 30, 30]);
  save();
  render();
  hideUndoToast();
}

function showUndoToast(message) {
  toastText.textContent = `Recorded ${message}`;
  undoToast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideUndoToast, 3200);
}

function hideUndoToast() {
  undoToast.classList.remove("show");
  clearTimeout(toastTimer);
}

function buzz(pattern) {
  if (state.settings.haptics && navigator.vibrate) navigator.vibrate(pattern);
}

function receiveAvg(player) {
  if (!player.receive.length) return "";
  return (player.receive.reduce((sum, value) => sum + value, 0) / player.receive.length).toFixed(2);
}

function zeroPct(player) {
  if (!player.receive.length) return 0;
  return player.receive.filter(value => Number(value) === 0).length / player.receive.length;
}

function passHistory(player) {
  return player.receive.length ? player.receive.join(", ") : "-";
}

function attackStats(player) {
  const attacks = player.attacks || [];
  const kills = attacks.filter(value => value === "+" || value === "T").length;
  const errors = attacks.filter(value => value === "-").length;
  const attempts = attacks.length;
  const tipKills = attacks.filter(value => value === "T").length;
  const tips = attacks.filter(value => value === "t").length;
  const pct = attempts ? ((kills - errors) / attempts).toFixed(3) : "";
  return { kills, errors, attempts, tipKills, tips, pct };
}

function teamSummary(team) {
  const receive = team.players.flatMap(player => player.receive);
  const sr = receive.length ? (receive.reduce((sum, value) => sum + value, 0) / receive.length).toFixed(2) : "0.00";
  const attacks = team.players.flatMap(player => player.attacks);
  const kills = attacks.filter(value => value === "+" || value === "T").length;
  const errors = attacks.filter(value => value === "-").length;
  const attempts = attacks.length;
  const hitPct = attempts ? ((kills - errors) / attempts).toFixed(3) : ".000";
  return { sr, kills, errors, attempts, hitPct };
}

function srRanks(team) {
  return team.players
    .filter(player => player.receive.length)
    .map(player => ({
      player,
      avg: Number(receiveAvg(player)),
      attempts: player.receive.length,
      zeros: zeroPct(player)
    }))
    .sort((a, b) => a.avg - b.avg || b.zeros - a.zeros || b.attempts - a.attempts);
}

function hitRanks(team) {
  return team.players
    .filter(player => player.attacks.length)
    .map(player => ({ player, stats: attackStats(player) }))
    .sort((a, b) => Number(b.stats.pct) - Number(a.stats.pct) || b.stats.attempts - a.stats.attempts);
}

function renderHeatMap(team) {
  if (!state.settings.receive || !state.settings.heat) return "";
  const ranks = srRanks(team).slice(0, 3);
  if (!ranks.length) return `<div class="heatMap"><div class="empty">SR heat map appears after the first pass. Ties sort worse by higher 0%.</div></div>`;

  return `<div class="heatMap">${[0, 1, 2].map(index => {
    const rank = ranks[index];
    if (!rank) return `<div class="heatCell">Target ${index + 1}<strong>-</strong>No data</div>`;
    return `<div class="heatCell rank${index + 1}">Target ${index + 1}<strong>${esc(label(rank.player.number))}</strong>Avg ${rank.avg.toFixed(2)} / 0s ${Math.round(rank.zeros * 100)}%</div>`;
  }).join("")}</div>`;
}

function renderTeam(team, teamIndex) {
  sortPlayers(team.players);
  const summary = teamSummary(team);
  return `
    <section class="team">
      <div class="teamTop">
        <input class="teamName" value="${esc(team.name)}" oninput="renameTeam(${teamIndex}, this.value)" autocomplete="off">
        <button type="button" class="rosterBtn" onclick="openRoster(${teamIndex})">Roster</button>
        <div class="teamStats">
          ${state.settings.receive ? `SR <b>${summary.sr}</b><br>` : ""}
          ${state.settings.attack ? `Hit <b>${summary.hitPct}</b><br>K/E/TA <b>${summary.kills}/${summary.errors}/${summary.attempts}</b>` : ""}
        </div>
      </div>
      ${renderHeatMap(team)}
      <div class="players">
        ${team.players.length ? team.players.map(player => renderPlayer(player, teamIndex)).join("") : `<div class="empty">Add players to start scouting.</div>`}
      </div>
    </section>
  `;
}

function renderPlayer(player, teamIndex) {
  const srAvg = receiveAvg(player) || "-";
  const srCount = player.receive.length || "-";
  const srZeroPct = player.receive.length ? `${Math.round(zeroPct(player) * 100)}%` : "-";
  const attacks = attackStats(player);
  const attackPct = attacks.pct || "-";

  return `
    <div class="playerRow ${player.libero ? "libero" : ""}">
      <div class="playerId">
        <div class="jersey">${esc(label(player.number))}</div>
        <div class="role">${player.libero ? "LIBERO" : "PLAYER"}</div>
      </div>
      <div class="playerMetrics">
        ${state.settings.receive ? `<div class="metric">SR<b>${srAvg}</b></div><div class="metric">Passes<b>${srCount}</b></div><div class="metric">0%<b>${srZeroPct}</b></div>` : ""}
        ${state.settings.attack || state.settings.receive ? `<div class="metricPair ${state.settings.attack && state.settings.receive ? "" : "singleMetricPair"}">${state.settings.attack ? `<div class="metric hitMetric">Hit %<b>${attackPct}</b><span>K/E/TA ${attacks.kills}/${attacks.errors}/${attacks.attempts}</span></div>` : ""}${state.settings.receive ? `<div class="metric historyMetric"><b>SR hist:</b> ${esc(passHistory(player))}</div>` : ""}</div>` : ""}
      </div>
      <div class="playerActions">
        ${state.settings.receive ? `<button type="button" class="srBtn" onclick="openScore('receive', ${teamIndex}, '${player.id}')">Serve Receive</button>` : ""}
        ${state.settings.attack ? `<button type="button" class="attBtn" onclick="handleAttackClick(${teamIndex}, '${player.id}')" ondblclick="handleAttackDoubleClick(event, ${teamIndex}, '${player.id}')" title="Double-click for attempt">Attack</button>` : ""}
      </div>
    </div>
  `;
}

function renderPrintSummary() {
  const teams = visibleTeams();
  document.getElementById("printSummary").innerHTML = `
    <h1>Volleyball Scout</h1>
    ${teams.map(team => {
      const summary = teamSummary(team);
      return `
        <div class="printTeam">
          <h2>${esc(team.name)}</h2>
          <p><b>SR Avg:</b> ${summary.sr} &nbsp; <b>Hit %:</b> ${summary.hitPct} &nbsp; <b>K/E/TA:</b> ${summary.kills}/${summary.errors}/${summary.attempts}</p>
          ${printTable("Serve Receive", ["Player", "Avg", "0%", "Passes"], srRanks(team).map(rank => [
            label(rank.player.number),
            rank.avg.toFixed(2),
            `${Math.round(rank.zeros * 100)}%`,
            rank.attempts
          ]))}
          ${printTable("Attacking", ["Player", "Hit %", "K", "E", "TA", "Tips"], hitRanks(team).map(rank => [
            label(rank.player.number),
            rank.stats.pct,
            rank.stats.kills,
            rank.stats.errors,
            rank.stats.attempts,
            `${rank.stats.tipKills}/${rank.stats.tips}`
          ]))}
        </div>
      `;
    }).join("")}
  `;
}

function todayStamp() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function timeStamp() {
  const date = new Date();
  return `${String(date.getHours()).padStart(2, "0")}-${String(date.getMinutes()).padStart(2, "0")}`;
}

function padRight(value, width) {
  let text = String(value);
  while (text.length < width) text += " ";
  return text;
}

function pdfEscape(value) {
  return String(value)
    .replace(/[^\x20-\x7E]/g, "-")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function trimPdfText(value, maxLength) {
  const text = String(value ?? "-");
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1))}.`;
}

function pdfColor(color) {
  const colors = {
    black: "0.08 0.08 0.08",
    blue: "0.08 0.22 0.38",
    darkGreen: "0.04 0.31 0.20",
    green: "0.90 0.97 0.92",
    red: "0.98 0.90 0.90",
    gray: "0.43 0.45 0.43",
    header: "0.13 0.15 0.13",
    line: "0.78 0.80 0.76",
    panel: "0.99 0.99 0.96",
    white: "1 1 1"
  };
  return colors[color] || colors.black;
}

function pdfText(text, x, y, size = 9, font = "F1", color = "black") {
  return `BT /${font} ${size} Tf ${pdfColor(color)} rg ${x.toFixed(1)} ${y.toFixed(1)} Td (${pdfEscape(text)}) Tj ET\n`;
}

function pdfRect(x, y, width, height, fill = null, stroke = "line") {
  let content = "";
  if (fill) content += `q ${pdfColor(fill)} rg ${x.toFixed(1)} ${y.toFixed(1)} ${width.toFixed(1)} ${height.toFixed(1)} re f Q\n`;
  if (stroke) content += `q ${pdfColor(stroke)} RG ${x.toFixed(1)} ${y.toFixed(1)} ${width.toFixed(1)} ${height.toFixed(1)} re S Q\n`;
  return content;
}

function pdfLine(x1, y1, x2, y2, color = "line") {
  return `q ${pdfColor(color)} RG ${x1.toFixed(1)} ${y1.toFixed(1)} m ${x2.toFixed(1)} ${y2.toFixed(1)} l S Q\n`;
}

function pdfCircle(cx, cy, radius, fill = null, stroke = "line") {
  const k = radius * 0.5522847498;
  let content = `q ${fill ? `${pdfColor(fill)} rg ` : ""}${stroke ? `${pdfColor(stroke)} RG ` : ""}`;
  content += `${(cx + radius).toFixed(1)} ${cy.toFixed(1)} m `;
  content += `${(cx + radius).toFixed(1)} ${(cy + k).toFixed(1)} ${(cx + k).toFixed(1)} ${(cy + radius).toFixed(1)} ${cx.toFixed(1)} ${(cy + radius).toFixed(1)} c `;
  content += `${(cx - k).toFixed(1)} ${(cy + radius).toFixed(1)} ${(cx - radius).toFixed(1)} ${(cy + k).toFixed(1)} ${(cx - radius).toFixed(1)} ${cy.toFixed(1)} c `;
  content += `${(cx - radius).toFixed(1)} ${(cy - k).toFixed(1)} ${(cx - k).toFixed(1)} ${(cy - radius).toFixed(1)} ${cx.toFixed(1)} ${(cy - radius).toFixed(1)} c `;
  content += `${(cx + k).toFixed(1)} ${(cy - radius).toFixed(1)} ${(cx + radius).toFixed(1)} ${(cy - k).toFixed(1)} ${(cx + radius).toFixed(1)} ${cy.toFixed(1)} c `;
  content += fill && stroke ? "B Q\n" : fill ? "f Q\n" : "S Q\n";
  return content;
}

function drawVolleyballMark(cx, cy) {
  return pdfCircle(cx, cy, 18, "white", "blue") +
    pdfLine(cx - 16, cy + 6, cx + 15, cy + 6, "line") +
    pdfLine(cx - 15, cy - 7, cx + 14, cy - 7, "line") +
    pdfLine(cx - 4, cy + 17, cx - 9, cy - 15, "line") +
    pdfLine(cx + 6, cy + 16, cx + 12, cy - 12, "line");
}

function drawSummaryBox(title, value, x, y, width, fill) {
  return pdfRect(x, y, width, 32, fill, "line") +
    pdfText(title, x + 7, y + 20, 7, "F2", "gray") +
    pdfText(value, x + 7, y + 7, 12, "F2", "black");
}

function drawTable(title, headers, rows, x, y, width, rowHeight, colWidths) {
  const headerHeight = 18;
  const titleHeight = 18;
  const tableHeight = titleHeight + headerHeight + Math.max(1, rows.length) * rowHeight;
  let content = pdfText(title, x, y - 12, 11, "F2", "blue");
  const tableTop = y - titleHeight;
  content += pdfRect(x, tableTop - headerHeight, width, headerHeight, "header", "header");

  let cursor = x;
  headers.forEach((header, index) => {
    content += pdfText(header, cursor + 4, tableTop - 12, 7.5, "F2", "white");
    cursor += colWidths[index];
  });

  const bodyTop = tableTop - headerHeight;
  const rowCount = Math.max(1, rows.length);
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
    const rowY = bodyTop - (rowIndex + 1) * rowHeight;
    content += pdfRect(x, rowY, width, rowHeight, rowIndex % 2 ? "white" : "panel", "line");
    cursor = x;
    (rows[rowIndex] || ["No data"]).forEach((cell, index) => {
      content += pdfText(trimPdfText(cell, index === headers.length - 1 ? 28 : 12), cursor + 4, rowY + 5, 7.2, "F1", "black");
      cursor += colWidths[index] || 0;
    });
  }

  cursor = x;
  colWidths.slice(0, -1).forEach(widthPart => {
    cursor += widthPart;
    content += pdfLine(cursor, tableTop - headerHeight, cursor, bodyTop - rowCount * rowHeight, "line");
  });

  return { content, height: tableHeight };
}

function pdfTeamRows(team) {
  return team.players.map(player => {
    const attacks = attackStats(player);
    const srHistory = passHistory(player);
    return [
      label(player.number),
      receiveAvg(player) || "-",
      player.receive.length ? `${Math.round(zeroPct(player) * 100)}%` : "-",
      player.receive.length || "-",
      attacks.pct || "-",
      `${attacks.kills}/${attacks.errors}/${attacks.attempts}`,
      srHistory || "-"
    ];
  });
}

function buildTeamPanel(team, teamIndex, x, y, width, maxRows) {
  const summary = teamSummary(team);
  const panelHeight = 498;
  let content = pdfRect(x, y - panelHeight, width, panelHeight, "white", "line");
  content += pdfRect(x, y - 34, width, 34, "blue", "blue");
  content += pdfText(team.name || `Team ${teamIndex + 1}`, x + 12, y - 22, 15, "F2", "white");

  const boxY = y - 76;
  const boxGap = 6;
  const boxWidth = (width - 24 - boxGap * 2) / 3;
  content += drawSummaryBox("SR Avg", summary.sr, x + 12, boxY, boxWidth, "green");
  content += drawSummaryBox("Hit %", summary.hitPct, x + 12 + boxWidth + boxGap, boxY, boxWidth, "panel");
  content += drawSummaryBox("K / E / TA", `${summary.kills}/${summary.errors}/${summary.attempts}`, x + 12 + (boxWidth + boxGap) * 2, boxY, boxWidth, "red");

  const rows = pdfTeamRows(team).slice(0, maxRows);
  const extraRows = Math.max(0, team.players.length - rows.length);
  const table = drawTable(
    extraRows ? `Roster Stats (${extraRows} more not shown)` : "Roster Stats",
    ["Player", "SR", "0%", "Pass", "Hit", "K/E/TA", "SR Hist"],
    rows,
    x + 12,
    y - 96,
    width - 24,
    17,
    [44, 32, 30, 34, 34, 46, width - 244]
  );
  content += table.content;
  return content;
}

function buildPdfBlob() {
  const pageWidth = 792;
  const pageHeight = 612;
  const margin = 28;
  const contentWidth = pageWidth - margin * 2;
  const teams = visibleTeams();
  const panelGap = teams.length > 1 ? 16 : 0;
  const panelWidth = teams.length > 1 ? (contentWidth - panelGap) / 2 : contentWidth;
  const maxRows = 20;

  let content = "";
  content += pdfRect(0, 0, pageWidth, pageHeight, "panel", null);
  content += pdfText("Volleyball Scout", margin, pageHeight - 34, 22, "F2", "blue");
  content += pdfText(`${todayStamp()} ${timeStamp().replace("-", ":")}   Tracking: ${state.settings.receive ? "Serve Receive" : ""}${state.settings.receive && state.settings.attack ? " + " : ""}${state.settings.attack ? "Attacking" : ""}`, margin, pageHeight - 52, 9, "F1", "gray");
  content += pdfText("Serve receive ties sort worse by higher 0%.", pageWidth - 248, pageHeight - 52, 8, "F1", "gray");
  content += pdfLine(margin, pageHeight - 64, pageWidth - margin, pageHeight - 64, "line");
  content += drawVolleyballMark(pageWidth - 48, pageHeight - 36);

  teams.forEach((team, index) => {
    content += buildTeamPanel(team, index, margin + index * (panelWidth + panelGap), pageHeight - 82, panelWidth, maxRows);
  });

  const objects = [];
  const fontRegular = 5;
  const fontBold = 6;

  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = "<< /Type /Pages /Kids [3 0 R] /Count 1 >>";
  objects[3] =
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] ` +
    `/Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >> >> ` +
    "/Contents 4 0 R >>";
  objects[4] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  objects[fontRegular] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  objects[fontBold] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>";

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let objectNumber = 1; objectNumber < objects.length; objectNumber++) {
    if (!objects[objectNumber]) continue;
    offsets[objectNumber] = pdf.length;
    pdf += `${objectNumber} 0 obj\n${objects[objectNumber]}\nendobj\n`;
  }

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length}\n`;
  pdf += "0000000000 65535 f \n";
  for (let index = 1; index < objects.length; index++) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF`;

  return new Blob([pdf], { type: "application/pdf" });
}

function safeFileName(value) {
  return (value || "volleyball_scout").trim().replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "") || "volleyball_scout";
}

function reportFileName() {
  const names = visibleTeams().map(team => team.name).filter(Boolean).join("_vs_");
  return `${safeFileName(names || "volleyball_scout")}_${todayStamp()}_${timeStamp()}.pdf`;
}

function openBlob(blob) {
  const url = URL.createObjectURL(blob);
  window.location.href = url;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.target = "_blank";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function showPdfPanel(blob, filename) {
  const oldUrl = pdfPanel.dataset.url;
  if (oldUrl) URL.revokeObjectURL(oldUrl);

  const url = URL.createObjectURL(blob);
  pdfPanel.dataset.url = url;
  pdfOpenLink.href = url;
  pdfDownloadLink.href = url;
  pdfDownloadLink.download = filename;
  pdfPanel.classList.add("show");
}

function hidePdfPanel() {
  const oldUrl = pdfPanel.dataset.url;
  if (oldUrl) URL.revokeObjectURL(oldUrl);
  delete pdfPanel.dataset.url;
  pdfPanel.classList.remove("show");
  pdfOpenLink.href = "#";
  pdfDownloadLink.href = "#";
}

function exportPDF() {
  const filename = reportFileName();
  const blob = buildPdfBlob();
  const file = new File([blob], filename, { type: "application/pdf" });
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);

  if (isIOS && navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) {
    navigator.share({ files: [file], title: "Volleyball Scout report" }).catch(error => {
      if (!error || error.name !== "AbortError") showPdfPanel(blob, filename);
    });
    return;
  }

  showPdfPanel(blob, filename);
}

function printTable(title, headers, rows) {
  if (!rows.length) return `<h3>${title}</h3><p>No data.</p>`;
  return `
    <h3>${title}</h3>
    <table>
      <thead><tr>${headers.map(header => `<th>${esc(header)}</th>`).join("")}</tr></thead>
      <tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${esc(cell)}</td>`).join("")}</tr>`).join("")}</tbody>
    </table>
  `;
}

function renameTeam(teamIndex, name) {
  state.teams[teamIndex].name = name;
  save();
  renderPrintSummary();
}

function resetAll() {
  clearDialog.showModal();
}

function confirmClearData() {
  localStorage.removeItem(STORAGE_KEY);
  state = {
    settings: { twoTeams: false, receive: true, attack: true, heat: true, haptics: true },
    teams: [
      { name: "Team", players: [] },
      { name: "Team 2", players: [] }
    ],
    history: []
  };
  save();
  render();
  clearDialog.close();
}

function bindStaticControls() {
  document.getElementById("settingsBtn").addEventListener("click", () => settingsPanel.classList.toggle("open"));
  document.getElementById("undoBtn").addEventListener("click", undoLast);
  document.getElementById("toastUndoBtn").addEventListener("click", undoLast);
  pdfCloseBtn.addEventListener("click", hidePdfPanel);
  document.getElementById("resetBtn").addEventListener("click", resetAll);
  document.getElementById("cancelClearBtn").addEventListener("click", () => clearDialog.close());
  document.getElementById("confirmClearBtn").addEventListener("click", confirmClearData);

  [
    ["twoTeamsToggle", "twoTeams"],
    ["receiveToggle", "receive"],
    ["attackToggle", "attack"],
    ["heatToggle", "heat"],
    ["hapticsToggle", "haptics"]
  ].forEach(([id, key]) => {
    const control = document.getElementById(id);
    control.addEventListener("change", () => {
      state.settings[key] = control.checked;
      save();
      render();
    });
  });
}

function render() {
  teamsEl.className = `teams${state.settings.twoTeams ? " two" : ""}`;
  teamsEl.innerHTML = visibleTeams().map((team, index) => renderTeam(team, index)).join("");
  document.getElementById("twoTeamsToggle").checked = state.settings.twoTeams;
  document.getElementById("receiveToggle").checked = state.settings.receive;
  document.getElementById("attackToggle").checked = state.settings.attack;
  document.getElementById("heatToggle").checked = state.settings.heat;
  document.getElementById("hapticsToggle").checked = state.settings.haptics;
  renderPrintSummary();
}

load();
bindStaticControls();
render();
