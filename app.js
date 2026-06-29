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
let resetTimer = null;

const teamsEl = document.getElementById("teams");
const settingsPanel = document.getElementById("settingsPanel");
const scoreDialog = document.getElementById("scoreDialog");
const scoreChoices = document.getElementById("scoreChoices");
const dialogTitle = document.getElementById("dialogTitle");
const dialogMeta = document.getElementById("dialogMeta");
const rosterDialog = document.getElementById("rosterDialog");
const rosterTitle = document.getElementById("rosterTitle");
const rosterList = document.getElementById("rosterList");
const undoToast = document.getElementById("undoToast");
const toastText = document.getElementById("toastText");

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
  rosterList.innerHTML = team.players.length
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
    : `<div class="empty">No players on this roster.</div>`;
  rosterDialog.showModal();
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
      { value: "+", text: "+" },
      { value: ".", text: "." },
      { value: "-", text: "-" },
      { value: "T", text: "T" },
      { value: "t", text: "t" }
    ];

  choices.forEach(choice => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = choice.text;
    button.addEventListener("click", () => recordScore(choice.value));
    scoreChoices.appendChild(button);
  });

  scoreDialog.showModal();
}

function recordScore(value) {
  if (!selectedScore) return;
  const player = findPlayer(selectedScore.team, selectedScore.id);
  if (!player) return;

  if (selectedScore.type === "receive") {
    player.receive.push(Number(value));
  } else {
    player.attacks.push(String(value));
  }

  state.history.push({
    type: selectedScore.type,
    team: selectedScore.team,
    id: selectedScore.id,
    value
  });

  buzz(60);
  save();
  render();
  scoreDialog.close();
  showUndoToast(`${label(player.number)} ${selectedScore.type === "receive" ? "SR" : "ATT"} ${value}`);
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
  if (!ranks.length) return `<div class="heatMap"><div class="empty">SR heat map appears after the first pass.</div></div>`;

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
      <div class="addRow">
        <input id="playerInput${teamIndex}" placeholder="Player # or name" inputmode="numeric" autocomplete="off" onkeydown="if(event.key==='Enter')addPlayer(${teamIndex}, false)">
        <button type="button" onclick="addPlayer(${teamIndex}, false)">Add</button>
        <button type="button" class="libBtn" onclick="addPlayer(${teamIndex}, true)">Lib</button>
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
  const attacks = attackStats(player);
  const attackPct = attacks.pct || "-";

  return `
    <div class="playerRow ${player.libero ? "libero" : ""}">
      <div class="playerId">
        <div class="jersey">${esc(label(player.number))}</div>
        <div class="role">${player.libero ? "LIBERO" : "PLAYER"}</div>
      </div>
      <div class="playerMetrics">
        ${state.settings.receive ? `<div class="metric">SR<b>${srAvg}</b></div><div class="metric">Passes<b>${srCount}</b></div>` : ""}
        ${state.settings.attack ? `<div class="metric">Hit %<b>${attackPct}</b></div>` : ""}
      </div>
      <div class="playerActions">
        ${state.settings.receive ? `<button type="button" class="srBtn" onclick="openScore('receive', ${teamIndex}, '${player.id}')">SR</button>` : ""}
        ${state.settings.attack ? `<button type="button" class="attBtn" onclick="openScore('attack', ${teamIndex}, '${player.id}')">ATT</button>` : ""}
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
  const button = document.getElementById("resetBtn");
  if (!button.classList.contains("confirmReset")) {
    button.classList.add("confirmReset");
    button.textContent = "Confirm";
    clearTimeout(resetTimer);
    resetTimer = setTimeout(() => {
      button.classList.remove("confirmReset");
      button.textContent = "Reset";
    }, 3000);
    return;
  }

  clearTimeout(resetTimer);
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
}

function bindStaticControls() {
  document.getElementById("settingsBtn").addEventListener("click", () => settingsPanel.classList.toggle("open"));
  document.getElementById("undoBtn").addEventListener("click", undoLast);
  document.getElementById("toastUndoBtn").addEventListener("click", undoLast);
  document.getElementById("printBtn").addEventListener("click", () => window.print());
  document.getElementById("resetBtn").addEventListener("click", resetAll);

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
