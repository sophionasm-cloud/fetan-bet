'use strict';

(() => {
  const COPY = {
    en: {
      balance: 'BALANCE', bet: 'BET', win: 'WIN', spin: 'SPIN', paytable: 'Paytable', fairness: 'Fairness',
      soundOff: 'Sound off', soundOn: 'Sound on', turbo: 'Turbo', auto: 'Auto', startAuto: 'Start', stopAuto: 'Stop',
      loading: 'Loading your balance…', ready: 'Choose a bet and spin.', spinning: 'Reels are spinning…',
      won: 'Won {amount} {currency}', noWin: 'No win this spin.', insufficient: 'Your balance is too low for this bet.',
      paused: 'Wagering is paused right now.', inProgress: 'A spin is still being settled. Try again shortly.',
      rate: 'Too many spins too quickly. Please wait a moment.', login: 'Log in to play Lucky Royale.',
      unavailable: 'Lucky Royale is temporarily unavailable. Please try again.', invalid: 'Choose a valid bet amount.',
      paytableHelp: 'Pays are per line, left to right. Wild substitutes for other symbols.',
      paylineHelp: 'All 10 paylines are active on every spin.', seedHash: 'Server seed hash', clientSeed: 'Client seed', nonce: 'Next nonce',
      autoStoppedBalance: 'Auto stopped because the balance cannot cover the bet.', autoStoppedWin: 'Auto stopped after a big win.',
      autoStoppedLoss: 'Auto stopped after one losing spin.', autoDone: 'Auto spins complete.', localPreview: 'LOCAL PREVIEW · Mock results only',
      revealedSeed: 'Revealed server seed', pendingSeed: 'Not revealed until seed rotation',
      nextCommitment: 'Next server seed hash', algorithm: 'Fairness method',
      decreaseBet: 'Decrease bet', increaseBet: 'Increase bet', autoCount: 'Automatic spin count',
      slotResult: 'Slot machine result', reelsLabel: 'Five reels with three symbols each', closePaytable: 'Close paytable',
      symbols: { heart: 'Heart', diamond: 'Diamond', spade: 'Spade', club: 'Club', seven: 'Seven', bar: 'Bar', bell: 'Bell', wild: 'Wild' },
    },
    am: {
      balance: 'ቀሪ ሂሳብ', bet: 'ውርርድ', win: 'አሸናፊ', spin: 'አሽከርክር', paytable: 'የክፍያ ሰንጠረዥ', fairness: 'ግልጽነት',
      soundOff: 'ድምፅ ጠፍቷል', soundOn: 'ድምፅ በርቷል', turbo: 'ፈጣን', auto: 'በራስ-ሰር', startAuto: 'ጀምር', stopAuto: 'አቁም',
      loading: 'ቀሪ ሂሳብ በመጫን ላይ…', ready: 'ውርርድ ይምረጡና ያሽከርክሩ።', spinning: 'ሪሎቹ በመዞር ላይ ናቸው…',
      won: '{amount} {currency} አሸንፈዋል', noWin: 'በዚህ ዙር አላሸነፉም።', insufficient: 'ቀሪ ሂሳብዎ ለዚህ ውርርድ በቂ አይደለም።',
      paused: 'አሁን ውርርድ ተቋርጧል።', inProgress: 'ዙር እየተጠናቀቀ ነው። ትንሽ ቆይተው ይሞክሩ።',
      rate: 'በፍጥነት ብዙ ጊዜ አሽከርክረዋል። እባክዎ ትንሽ ይጠብቁ።', login: 'Lucky Royale ለመጫወት ይግቡ።',
      unavailable: 'Lucky Royale ለጊዜው አይገኝም። እባክዎ እንደገና ይሞክሩ።', invalid: 'ትክክለኛ የውርርድ መጠን ይምረጡ።',
      paytableHelp: 'ክፍያዎች በመስመር ከግራ ወደ ቀኝ ናቸው። ዋይልድ ምልክት ሌሎችን ይተካል።',
      paylineHelp: 'በእያንዳንዱ ዙር 10 የክፍያ መስመሮች ንቁ ናቸው።', seedHash: 'የሰርቨር ዘር ሃሽ', clientSeed: 'የደንበኛ ዘር', nonce: 'ቀጣይ ቁጥር',
      autoStoppedBalance: 'ቀሪ ሂሳቡ ውርርዱን ስለማይሸፍን በራስ-ሰር ቆሟል።', autoStoppedWin: 'ትልቅ አሸናፊ ስለነበር በራስ-ሰር ቆሟል።',
      autoStoppedLoss: 'አንድ የተሸነፈ ዙር በኋላ በራስ-ሰር ቆሟል።', autoDone: 'በራስ-ሰር ዙሮች ተጠናቀዋል።', localPreview: 'የአካባቢ ቅድመ እይታ · የሙከራ ውጤቶች ብቻ',
      revealedSeed: 'የተገለጠ የሰርቨር ዘር', pendingSeed: 'ዘሩ እስኪቀየር ድረስ አይገለጥም',
      nextCommitment: 'ቀጣይ የሰርቨር ዘር ሃሽ', algorithm: 'የግልጽነት ዘዴ',
      decreaseBet: 'ውርርድ ቀንስ', increaseBet: 'ውርርድ ጨምር', autoCount: 'በራስ-ሰር ዙር ብዛት',
      slotResult: 'የስሎት ውጤት', reelsLabel: 'ሶስት ምልክቶች ያሏቸው አምስት ሪሎች', closePaytable: 'የክፍያ ሰንጠረዥ ዝጋ',
      symbols: { heart: 'ልብ', diamond: 'አልማዝ', spade: 'ስፔድ', club: 'ክለብ', seven: 'ሰባት', bar: 'ባር', bell: 'ደወል', wild: 'ዋይልድ' },
    },
  };
  const interpolate = (template, values = {}) => String(template).replace(/\{(\w+)\}/g, (_match, key) => String(values[key] ?? ''));
  async function load(language = 'en') {
    const lang = language === 'am' ? 'am' : 'en';
    let wallet = {};
    try {
      const response = await fetch(`/api/i18n/${lang}`, { credentials: 'same-origin' });
      if (response.ok) wallet = await response.json();
    } catch (_) { /* Local copy remains available while the locale endpoint is offline. */ }
    return { lang, copy: COPY[lang], symbols: COPY[lang].symbols, currency: wallet.currency_etb || (lang === 'am' ? 'ብር' : 'ETB') };
  }
  function formatMoney(santim, lang) {
    const amount = Number.isSafeInteger(santim) ? santim / 100 : 0;
    return new Intl.NumberFormat(lang === 'am' ? 'am-ET' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
  }
  window.SLOT_I18N = Object.freeze({ load, formatMoney, interpolate });
})();
