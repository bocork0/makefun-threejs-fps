// Rounds and money. A match is first to 5 rounds, at most 9. Each round has a
// 12 s buy phase (the buy menu is open, everyone waits at spawn), a live phase
// of up to 100 s, and a short end banner. Ember wins by eliminating the
// Wardens or by planting the Spark and letting its 35 s fuse run out; Warden
// wins by elimination, by defusing a planted Spark, or by running the clock
// out with no plant. Winners take $3,250, losers $1,900, a kill pays $300.
// The Spark is carried by the player on rounds 1, 4 and 7, otherwise by a
// random Ember bot; when its carrier dies it drops where it fell, and any
// Ember walking over it picks it up.
import { createChannel } from './bots.js';
import { WEAPONS, GRENADES, ARMOR_PRICE, createWeaponState } from './weapons.js';
import { botBuy, planRound } from './bots.js';
import { resetActor } from './actors.js';

const BUY_SECONDS = 12;
const ROUND_SECONDS = 100;
const FUSE_SECONDS = 35;
const END_SECONDS = 5;
const WIN_ROUNDS = 5;
const MAX_ROUNDS = 9;
const WIN_MONEY = 3250;
const LOSS_MONEY = 1900;
const KILL_MONEY = 300;

export function createRounds(ctx) {
  const spike = {
    state: 'carried', // carried | dropped | planted | defused | detonated
    carrier: null,
    site: null,
    x: 0,
    z: 0,
    fuse: FUSE_SECONDS,
  };
  ctx.spike = spike;

  const rounds = {
    phase: 'buy',
    phaseTime: BUY_SECONDS,
    round: 1,
    roundTime: ROUND_SECONDS,
    scores: { ember: 0, warden: 0 },
    lastReason: '',
    matchWinner: null,
    plantChannel: createChannel(3),
  };

  function aliveCount(team) {
    return ctx.actors.filter((actor) => actor.team === team && actor.alive).length;
  }

  function startRound() {
    rounds.phase = 'buy';
    rounds.phaseTime = BUY_SECONDS;
    rounds.roundTime = ROUND_SECONDS;
    spike.state = 'carried';
    spike.site = null;
    spike.fuse = FUSE_SECONDS;
    rounds.plantChannel.reset();
    // Everyone back to spawn, weapons kept, health restored.
    const emberSpawns = ctx.map.spawns.ember;
    const wardenSpawns = ctx.map.spawns.warden;
    let ei = 0;
    let wi = 0;
    for (const actor of ctx.actors) {
      const spawn = actor.team === 'ember' ? emberSpawns[ei++ % emberSpawns.length] : wardenSpawns[wi++ % wardenSpawns.length];
      // Ember spawns south and faces north into the yard; Warden the reverse.
      const yaw = actor.team === 'ember' ? 0 : Math.PI;
      resetActor(actor, spawn.x, spawn.z, yaw);
    }
    // The Spark: the player carries on rounds 1, 4 and 7, else a random bot.
    const emberBots = ctx.actors.filter((a) => a.team === 'ember' && !a.isPlayer);
    if (rounds.round % 3 === 1) {
      spike.carrier = ctx.player;
      ctx.player.hasSpike = true;
    } else {
      const carrier = emberBots[Math.floor(ctx.random() * emberBots.length)];
      spike.carrier = carrier;
      carrier.hasSpike = true;
    }
    spike.x = spike.carrier.body.position.x;
    spike.z = spike.carrier.body.position.z;
    for (const brain of ctx.brains) {
      botBuy(brain.actor, ctx.random);
      planRound(ctx, brain, ctx.random);
    }
    ctx.events.push({ type: 'roundStart', round: rounds.round, time: ctx.time });
    ctx.audio.roundStart();
    ctx.hud.showBuyPhase(rounds.round, BUY_SECONDS);
  }

  function startLive() {
    rounds.phase = 'live';
    ctx.hud.hideBuy();
    ctx.events.push({ type: 'live', time: ctx.time });
  }

  function endRound(winner, reason) {
    if (rounds.phase === 'end' || rounds.phase === 'match') return;
    rounds.phase = 'end';
    rounds.phaseTime = END_SECONDS;
    rounds.lastReason = reason;
    rounds.scores[winner] += 1;
    for (const actor of ctx.actors) {
      const won = actor.team === winner;
      actor.money += won ? WIN_MONEY : LOSS_MONEY;
    }
    ctx.events.push({ type: 'roundEnd', winner, reason, time: ctx.time });
    if (ctx.player.team === winner) ctx.audio.roundWin();
    else ctx.audio.roundLose();
    ctx.hud.showRoundEnd(winner, reason, rounds.scores, rounds.round);
  }

  function endMatch() {
    rounds.phase = 'match';
    rounds.matchWinner = rounds.scores.ember > rounds.scores.warden ? 'ember' : 'warden';
    ctx.hud.showMatchEnd(rounds.matchWinner, rounds.scores);
  }

  function update(dt) {
    if (rounds.phase === 'buy') {
      rounds.phaseTime -= dt;
      if (rounds.phaseTime <= 0) startLive();
      return;
    }
    if (rounds.phase === 'end') {
      rounds.phaseTime -= dt;
      if (rounds.phaseTime <= 0) {
        const over = rounds.scores.ember >= WIN_ROUNDS || rounds.scores.warden >= WIN_ROUNDS || rounds.round >= MAX_ROUNDS;
        if (over) endMatch();
        else {
          rounds.round += 1;
          startRound();
        }
      }
      return;
    }
    if (rounds.phase !== 'live') return;

    rounds.roundTime -= dt;
    if (spike.state === 'planted') {
      spike.fuse -= dt;
      if (Math.ceil(spike.fuse) !== Math.ceil(spike.fuse + dt)) ctx.audio.spikeTick();
      if (spike.fuse <= 0) {
        spike.state = 'detonated';
        ctx.audio.explosion();
        endRound('ember', 'The Spark detonated at Site ' + spike.site);
        return;
      }
    }
    if (spike.state === 'defused') {
      endRound('warden', 'The Spark was defused');
      return;
    }
    const emberAlive = aliveCount('ember');
    const wardenAlive = aliveCount('warden');
    if (emberAlive === 0) {
      endRound('warden', 'Ember team eliminated');
      return;
    }
    if (wardenAlive === 0) {
      endRound('ember', 'Warden team eliminated');
      return;
    }
    if (rounds.roundTime <= 0 && spike.state !== 'planted') {
      endRound('warden', 'Time expired — no plant');
    }
  }

  // The player plants with E held inside a site while carrying the Spark.
  function playerPlantTick(dt, holding) {
    const player = ctx.player;
    if (spike.state !== 'carried' || spike.carrier !== player) return false;
    const site = ctx.map.sites.find((s) => {
      const d = Math.hypot(s.center.x - player.body.position.x, s.center.z - player.body.position.z);
      return d < s.radius;
    });
    if (!site) {
      rounds.plantChannel.reset();
      return false;
    }
    if (holding && rounds.plantChannel.tick(dt, true)) {
      spike.state = 'planted';
      spike.site = site.id;
      spike.fuse = FUSE_SECONDS;
      spike.x = player.body.position.x;
      spike.z = player.body.position.z;
      player.hasSpike = false;
      ctx.events.push({ type: 'spikePlanted', actor: player, site: site.id, time: ctx.time });
      ctx.audio.plantBeep(true);
      return true;
    }
    if (!holding) rounds.plantChannel.reset();
    return false;
  }

  // Defusing is the Warden bots' job (see bots.js): the player is always Ember.
  function buyWeapon(player, id) {
    const def = WEAPONS[id];
    if (!def || player.money < def.price) return false;
    player.money -= def.price;
    player.weapon = createWeaponState(def);
    ctx.events.push({ type: 'buy', what: def.name, time: ctx.time });
    ctx.audio.buy();
    return true;
  }

  function buyGrenade(player, kind) {
    const def = GRENADES[kind];
    if (!def || player.money < def.price) return false;
    player.money -= def.price;
    player.grenades[kind] += 1;
    ctx.audio.buy();
    return true;
  }

  function buyArmor(player) {
    if (player.money < ARMOR_PRICE || player.armor >= 50) return false;
    player.money -= ARMOR_PRICE;
    player.armor = 50;
    ctx.audio.buy();
    return true;
  }

  return {
    rounds,
    spike,
    aliveCount,
    startRound,
    update,
    playerPlantTick,
    buyWeapon,
    buyGrenade,
    buyArmor,
    KILL_MONEY,
  };
}
