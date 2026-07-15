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

const CRIT_TABLE = [
  { key: "normal", mult: 1.0, weight: 70 },
  { key: "crit1",  mult: 1.2, weight: 20 },
  { key: "crit2",  mult: 1.5, weight: 7 },
  { key: "crit3",  mult: 2.0, weight: 2.5 },
  { key: "crit4",  mult: 5.0, weight: 0.5 },
];
const HIT_INTERVAL_BY_TYPE = { normal: 260, mid: 230, big: 200, demon: 170 };

// #35: 運によるレアモブ出現(index.htmlのRARE_MOB_TABLE等と同じ設計)
const RARE_MOB_TABLE = [
  { key: "normal", weight: 90 },
  { key: "rareMob", weight: 10 },
];
const RARE_MOB_EXP_MULT = 2.5;
const RARE_MOB_LUCK_BONUS = 0.4;

function rollTalent() {
  const r = (Math.random() + Math.random()) / 2;
  return +(TALENT_MIN + r * (TALENT_MAX - TALENT_MIN)).toFixed(2);
}
function rollLuck() { return Math.random(); }
// luckは1プレイ中ずっと一定のため、重み付けテーブルは1回だけ構築して使い回す
// (ヒットのたびに毎回 .map() し直すと300万試行規模のシミュレーションが
// 極端に遅くなる。index.htmlのbuildLuckRoller/rollFromTableと同じ設計)。
function buildLuckRoller(table, luck) {
  const boosted = table.map((item, i) => ({ ...item, w: item.weight * (1 + luck * i * 1.8) }));
  const total = boosted.reduce((s, item) => s + item.w, 0);
  return { boosted, total };
}
function rollFromTable(roller) {
  let r = Math.random() * roller.total;
  for (const item of roller.boosted) {
    if (r < item.w) return item;
    r -= item.w;
  }
  return roller.boosted[roller.boosted.length - 1];
}
// #43: ブロック2・3にのみ線形+二次の追加項を乗せ、中盤のノーリスク区間を解消(index.htmlのmidBossHp/bigBossHpと同じ式)
function midBossHp(block) {
  return 45 + block * 18 + 18 * (block - 1) + 6 * Math.pow(block - 1, 2);
}
function bigBossHp(block) {
  return 70 + block * 35 + 34 * (block - 1) + 12 * Math.pow(block - 1, 2);
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
    seq.push({ label: `第${n}面(中ボス)`, type: "mid", timeLimit: 5, hpBase: midBossHp(block) });
    seq.push({ label: `大ボス${block}`, type: "big", timeLimit: 8, hpBase: bigBossHp(block) });
  }
  seq.push({ label: "魔王", type: "demon", timeLimit: 10, hpBase: 650 });
  return seq;
}
function computeHeroDps(level, gear) {
  return BASE_ATK * (1 + (level - 1) * LEVEL_BONUS) * gear.atkMul;
}
// ㉑ ゲーム本体と同じく、1面ごとにヒット単位でクリティカルを抽選し実ダメージを
// 積み上げる。事前計算(hpBase/dps)ではなく、実際にヒットを重ねて制限時間内に
// 倒しきれたかどうかで判定する(index.htmlのframe()と同じロジック)。
function simulateStage(dps, critRoller, s) {
  const hitInterval = HIT_INTERVAL_BY_TYPE[s.type] || 260;
  const totalDurationMs = s.timeLimit * 1000;
  const baseDamagePerHit = dps * (hitInterval / 1000);
  const numHits = Math.floor(totalDurationMs / hitInterval);
  let dealt = 0;
  for (let h = 0; h < numHits; h++) {
    const crit = rollFromTable(critRoller);
    dealt += baseDamagePerHit * crit.mult;
    if (dealt >= s.hpBase) return true;
  }
  return false;
}

function runOne() {
  const talent = rollTalent();
  const luck = rollLuck();
  const gearRoller = buildLuckRoller(GEAR_TABLE, luck);
  const critRoller = buildLuckRoller(CRIT_TABLE, luck);
  const rareMobRoller = buildLuckRoller(RARE_MOB_TABLE, luck);
  const rareMobGearRoller = buildLuckRoller(GEAR_TABLE, Math.min(1, luck + RARE_MOB_LUCK_BONUS));
  let level = 1, exp = 0, expToNext = EXP_BASE, gear = GEAR_TABLE[0];
  const stages = buildStageSequence();
  let reachedIndex = -1;
  let rareMobEncounters = 0;
  for (let i = 0; i < stages.length; i++) {
    const s = stages[i];
    const dps = computeHeroDps(level, gear);
    if (!simulateStage(dps, critRoller, s)) return { reachedIndex: i, cleared: false, rareMobEncounters };
    reachedIndex = i;
    const isRareMob = s.type === "normal" && rollFromTable(rareMobRoller).key === "rareMob";
    if (isRareMob) rareMobEncounters++;
    const baseExpGain = EXP_PER_STAGE * (s.type === "normal" ? 1 : s.type === "big" ? 3 : s.type === "demon" ? 6 : 2);
    exp += (isRareMob ? baseExpGain * RARE_MOB_EXP_MULT : baseExpGain) * talent;
    while (exp >= expToNext) { exp -= expToNext; level++; expToNext = Math.round(expToNext * EXP_CURVE); }
    const dropped = rollFromTable(isRareMob ? rareMobGearRoller : gearRoller);
    const curIdx = GEAR_TABLE.findIndex((g) => g.key === gear.key);
    const dropIdx = GEAR_TABLE.findIndex((g) => g.key === dropped.key);
    if (dropIdx > curIdx) gear = dropped;
  }
  return { reachedIndex, cleared: true, rareMobEncounters };
}

function simulate(n) {
  let cleared = 0;
  let totalRareMobEncounters = 0;
  let runsWithRareMob = 0;
  const failStageCount = {};
  for (let i = 0; i < n; i++) {
    const r = runOne();
    if (r.cleared) cleared++;
    else failStageCount[r.reachedIndex] = (failStageCount[r.reachedIndex] || 0) + 1;
    totalRareMobEncounters += r.rareMobEncounters;
    if (r.rareMobEncounters > 0) runsWithRareMob++;
  }
  return { clearRate: cleared / n, failStageCount, totalRareMobEncounters, runsWithRareMob };
}

const N = 300000;
const { clearRate, failStageCount, totalRareMobEncounters, runsWithRareMob } = simulate(N);
console.log(`試行回数: ${N}`);
console.log(`魔王撃破率: ${(clearRate * 100).toFixed(2)}% (目標 5〜10%)`);
console.log("敗北ステージ分布(index: 回数):", failStageCount);
console.log(`平均レアモブ遭遇回数/run: ${(totalRareMobEncounters / N).toFixed(2)}`);
console.log(`レアモブに1回以上遭遇したrunの割合: ${((runsWithRareMob / N) * 100).toFixed(1)}%`);
