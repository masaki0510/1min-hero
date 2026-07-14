// バランス検証用モンテカルロシミュレーション(Node実行専用、ゲーム本体には含まれない)
// index.html のガチャ・戦闘計算ロジックを再現し、大量試行で魔王撃破率などを確認する。
// 実行: node tools/balance_sim.js
"use strict";

const TALENT_MIN = 0.5, TALENT_MAX = 3.0;
const GEAR_TABLE = [
  { key: "common", weight: 70, atkMul: 1.00 },
  { key: "rare",   weight: 20, atkMul: 1.3 },
  { key: "epic",   weight: 8,  atkMul: 1.7 },
  { key: "legend", weight: 2,  atkMul: 2.4 },
];
const BASE_ATK = 8;
const LEVEL_BONUS = 0.22;
const EXP_BASE = 20;
const EXP_CURVE = 1.3;
const EXP_PER_STAGE = 10;

function rollTalent() {
  const r = (Math.random() + Math.random()) / 2;
  return +(TALENT_MIN + r * (TALENT_MAX - TALENT_MIN)).toFixed(2);
}
function rollLuck() { return Math.random(); }
function rollGear(luck) {
  const boosted = GEAR_TABLE.map((g, i) => ({ ...g, w: g.weight * (1 + luck * i * 1.8) }));
  const total = boosted.reduce((s, g) => s + g.w, 0);
  let r = Math.random() * total;
  for (const g of boosted) { if (r < g.w) return g; r -= g.w; }
  return boosted[0];
}
function buildStageSequence() {
  const seq = [];
  let n = 0;
  for (let block = 1; block <= 3; block++) {
    for (let i = 0; i < 2; i++) {
      n++;
      seq.push({ label: `第${n}面`, type: "normal", timeLimit: 3, hpBase: 10 + (n - 1) * 2.2 });
    }
    n++;
    seq.push({ label: `第${n}面(中ボス)`, type: "mid", timeLimit: 5, hpBase: 45 + block * 18 });
    seq.push({ label: `大ボス${block}`, type: "big", timeLimit: 8, hpBase: 70 + block * 35 });
  }
  seq.push({ label: "魔王", type: "demon", timeLimit: 10, hpBase: 520 });
  return seq;
}
function computeHeroDps(level, gear) {
  return BASE_ATK * (1 + (level - 1) * LEVEL_BONUS) * gear.atkMul;
}
function runOne() {
  const talent = rollTalent();
  const luck = rollLuck();
  let level = 1, exp = 0, expToNext = EXP_BASE, gear = GEAR_TABLE[0];
  const stages = buildStageSequence();
  let reachedIndex = -1;
  for (let i = 0; i < stages.length; i++) {
    const s = stages[i];
    const dps = computeHeroDps(level, gear);
    if (s.hpBase / dps > s.timeLimit) return { reachedIndex: i, cleared: false };
    reachedIndex = i;
    const expGain = EXP_PER_STAGE * (s.type === "normal" ? 1 : s.type === "big" ? 3 : s.type === "demon" ? 6 : 2);
    exp += expGain * talent;
    while (exp >= expToNext) { exp -= expToNext; level++; expToNext = Math.round(expToNext * EXP_CURVE); }
    const dropped = rollGear(luck);
    const curIdx = GEAR_TABLE.findIndex((g) => g.key === gear.key);
    const dropIdx = GEAR_TABLE.findIndex((g) => g.key === dropped.key);
    if (dropIdx > curIdx) gear = dropped;
  }
  return { reachedIndex, cleared: true };
}

function simulate(n) {
  let cleared = 0;
  const failStageCount = {};
  for (let i = 0; i < n; i++) {
    const r = runOne();
    if (r.cleared) cleared++;
    else failStageCount[r.reachedIndex] = (failStageCount[r.reachedIndex] || 0) + 1;
  }
  return { clearRate: cleared / n, failStageCount };
}

const N = 300000;
const { clearRate, failStageCount } = simulate(N);
console.log(`試行回数: ${N}`);
console.log(`魔王撃破率: ${(clearRate * 100).toFixed(2)}% (目標 5〜10%)`);
console.log("敗北ステージ分布(index: 回数):", failStageCount);
