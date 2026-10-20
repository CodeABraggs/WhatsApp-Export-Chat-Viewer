/* Builds a sample group chat export (Android format) so the viewer can be tried without a real file. */
(function (global) {
  'use strict';

  const pad = n => String(n).padStart(2, '0');

  function day(offset) {
    const d = new Date();
    d.setDate(d.getDate() - offset);
    return d;
  }

  const stamp = (offset, hm) => {
    const d = day(offset);
    return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear() + ', ' + hm + ' - ';
  };

  const ymd = offset => {
    const d = day(offset);
    return '' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());
  };

  // A small sunset-over-mountains picture, drawn on a canvas so the demo has a real photo attachment.
  function picture() {
    return new Promise(resolve => {
      const c = document.createElement('canvas');
      c.width = 960; c.height = 720;
      const g = c.getContext('2d');
      const sky = g.createLinearGradient(0, 0, 0, 470);
      sky.addColorStop(0, '#2c3e75');
      sky.addColorStop(0.55, '#e0748a');
      sky.addColorStop(1, '#ffc58a');
      g.fillStyle = sky;
      g.fillRect(0, 0, 960, 470);
      g.fillStyle = '#fff3c4';
      g.beginPath(); g.arc(640, 360, 64, 0, Math.PI * 2); g.fill();

      const ridge = (color, base, peaks) => {
        g.fillStyle = color;
        g.beginPath(); g.moveTo(0, 720); g.lineTo(0, base);
        peaks.forEach(([x, y]) => g.lineTo(x, y));
        g.lineTo(960, base); g.lineTo(960, 720); g.closePath(); g.fill();
      };
      ridge('#7a4f7f', 400, [[120, 300], [250, 380], [400, 250], [560, 390], [720, 280], [860, 360], [960, 320]]);
      ridge('#4b3563', 450, [[90, 410], [230, 340], [380, 440], [520, 360], [700, 450], [840, 380], [960, 430]]);

      const lake = g.createLinearGradient(0, 470, 0, 720);
      lake.addColorStop(0, '#f2a07b');
      lake.addColorStop(1, '#3b2b55');
      g.fillStyle = lake;
      g.fillRect(0, 470, 960, 250);
      g.fillStyle = 'rgba(255,243,196,.45)';
      for (let i = 0; i < 9; i++) g.fillRect(600 - i * 6, 490 + i * 22, 80 + i * 12, 4);

      g.fillStyle = '#1f1b33';
      [[40, 720, 120], [130, 720, 170], [210, 720, 110], [820, 720, 150], [900, 720, 190]].forEach(([x, y, h]) => {
        for (let k = 0; k < 4; k++) {
          const w = 70 - k * 12, top = y - h + k * 18;
          g.beginPath(); g.moveTo(x, top); g.lineTo(x - w / 2, top + h * 0.45); g.lineTo(x + w / 2, top + h * 0.45); g.closePath(); g.fill();
        }
        g.fillRect(x - 5, y - 30, 10, 30);
      });
      g.fillRect(0, 700, 960, 20);
      c.toBlob(b => resolve(b), 'image/jpeg', 0.86);
    });
  }

  // A short synthesized "voice note" (a little melody) as a 16-bit mono WAV.
  function voiceNote() {
    const rate = 16000, secs = 4.2, n = Math.floor(rate * secs);
    const buf = new ArrayBuffer(44 + n * 2);
    const v = new DataView(buf);
    const str = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, n * 2, true);
    const notes = [523.25, 659.25, 783.99, 659.25, 698.46, 880, 783.99];
    const len = secs / notes.length;
    for (let i = 0; i < n; i++) {
      const t = i / rate, k = Math.min(notes.length - 1, Math.floor(t / len)), local = t - k * len;
      const env = Math.min(1, local * 30) * Math.exp(-local * 3.2);
      const sample = Math.sin(2 * Math.PI * notes[k] * t) * 0.6 + Math.sin(4 * Math.PI * notes[k] * t) * 0.15;
      v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, sample * env * 0.7)) * 32767, true);
    }
    return new Blob([buf], { type: 'audio/wav' });
  }

  const STORY = [
    'Okay so here is the full plan for Saturday, because I know half of you will ask again on Friday night 😅',
    '',
    '*Morning*',
    '- 7:00 meet at the trailhead parking (pin above)',
    '- 7:15 start the ridge loop — it is about 11 km with 650 m of climbing, so bring at least 2 litres of water each',
    '- 9:30 breakfast stop at the lookout. I am bringing the camping stove, coffee and the good pancake mix',
    '',
    '*Afternoon*',
    '- Back at the cabin by 1 for lunch and a nap (non-negotiable)',
    '- 3:00 kayaks are booked at the boathouse for two hours. They have life jackets but bring a dry bag for phones',
    '- Whoever is not kayaking can go for the waterfall walk, it is flat and only 40 minutes return',
    '',
    '*Evening*',
    '- BBQ won the poll so Leo is on grill duty 🍖',
    '- Maya has the playlist, Sam has the board games, I have the marshmallows',
    '- Stargazing on the jetty after dinner if the sky is clear — the forecast says it will be',
    '',
    'Things people always forget: a head torch, a warm layer for the evening (it gets properly cold by the lake), sunscreen, and chargers. ',
    'Also please send me your share for the cabin by Thursday so I can settle with the host. It works out to the same amount each as we discussed, and I will post the receipt here once it is paid.',
    '',
    '> The mountains are calling and I must go',
    'See you all soon! 🏔️'
  ].join('\n');

  async function build() {
    const img = 'IMG-' + ymd(3) + '-WA0001.jpg';
    const ptt = 'PTT-' + ymd(2) + '-WA0002.wav';
    const L = (o, hm, body) => stamp(o, hm) + body;
    const lines = [
      L(3, '09:12', 'Messages and calls are end-to-end encrypted. No one outside of this chat, not even WhatsApp, can read or listen to them. Tap to learn more.'),
      L(3, '09:12', 'Maya created group "Weekend Trip Crew"'),
      L(3, '09:12', 'Maya added Leo, Sam and Alex'),
      L(3, '09:15', 'Maya: Okay team, the cabin is *officially booked* 🎉'),
      L(3, '09:15', 'Maya: Check-in Friday 3 PM, checkout Sunday 11 AM'),
      L(3, '09:17', 'Leo: Let\'s gooo'),
      L(3, '09:17', 'Leo: 🔥🔥🔥'),
      L(3, '09:20', 'Alex: Amazing! Who\'s driving? I can take 3 people in my car'),
      L(3, '09:21', 'Sam: Me! I\'ll bring snacks _and_ the speaker 🎶'),
      L(3, '09:23', 'Alex: You deleted this message'),
      L(3, '09:24', 'Alex: Ignore that 🙈'),
      L(3, '09:30', 'Maya: Here\'s the listing: https://www.example.com/cabins/pine-ridge'),
      L(3, '09:31', 'Maya: ' + img + ' (file attached)\nView from the deck at sunset 😍'),
      L(3, '09:33', 'Sam: WOW'),
      L(3, '09:33', 'Sam: This message was deleted'),
      L(2, '18:02', 'Leo: POLL:\nWhat should we cook Saturday night?\nOPTION: BBQ 🍖 (3 votes)\nOPTION: Pasta night 🍝 (1 vote)\nOPTION: Pizza 🍕 (0 votes)'),
      L(2, '18:10', 'Sam: Packing list so far:\n- Sleeping bags\n- Board games\n- ~Umbrella~ forecast says sunny ☀️\n- Hiking boots'),
      L(2, '18:12', 'Alex: Don\'t forget ```bug spray``` this time 😂'),
      L(2, '18:14', 'Maya: ' + ptt + ' (file attached)'),
      L(2, '19:45', 'Maya: Missed voice call'),
      L(2, '19:47', 'Maya: Call me when you\'re free, need to sort the deposit'),
      L(1, '08:05', 'Leo: location: https://maps.google.com/?q=46.5197,6.6323'),
      L(1, '08:06', 'Leo: Meeting point ☝️ at 7 sharp'),
      L(1, '08:07', 'Alex: 👍'),
      L(1, '21:40', 'Alex: ' + STORY),
      L(1, '21:52', 'Maya: Legend. Saving this 📌'),
      L(0, '07:58', 'Maya: Leaving now! <This message was edited>'),
      L(0, '08:01', 'Alex: On my way 🚗💨'),
      L(0, '08:01', 'Sam: <Media omitted>'),
      L(0, '08:02', 'Sam: Traffic is _terrible_ on the bridge, might be 10 min late'),
      L(0, '08:30', 'Leo: Made it! Coffee is on ☕')
    ];
    const blob = await picture();
    const files = [new File([voiceNote()], ptt, { type: 'audio/wav' })];
    if (blob) files.push(new File([blob], img, { type: 'image/jpeg' }));
    return { text: lines.join('\n'), name: 'WhatsApp Chat with Weekend Trip Crew.txt', files };
  }

  global.WADemo = { build };
})(window);
