// Fetan Bet — AI Customer Support Assistant
// Intelligent, verified customer support engine with knowledge base and automatic human agent escalation.

function getAiResponse(userMessage, context = {}) {
  const msg = String(userMessage || '').trim();
  const lower = msg.toLowerCase();
  const isAmharic = /[\u1200-\u137F]/.test(msg);
  const user = context.user || {};
  const pendingDeposits = context.pendingDeposits || [];
  const pendingWithdrawals = context.pendingWithdrawals || [];
  const balance = context.balance !== undefined ? context.balance / 100 : 0;

  // 1. Escalation triggers (Human request, payment dispute, complaints)
  const humanKeywords = ['agent', 'human', 'person', 'support person', 'manager', 'admin', 'ሰው', 'ወኪል', 'አስተዳዳሪ', 'እውነተኛ ሰው'];
  const wantsHuman = humanKeywords.some((k) => lower.includes(k) || msg.includes(k));

  const disputeKeywords = ['dispute', 'scam', 'fraud', 'stolen', 'didn\'t receive', 'didn\'t arrive', 'not credited', 'where is my money', 'lost money', 'complaint', 'ችግር', 'አልደረሰም', 'አልገባም', 'አልተቀበልኩም', 'ስርቆት', 'አጭበረበረ'];
  const isDispute = disputeKeywords.some((k) => lower.includes(k) || msg.includes(k));

  if (wantsHuman || isDispute) {
    const reason = wantsHuman
      ? 'Customer requested direct human agent support'
      : 'Transaction inquiry or dispute reported by customer';
    const reply = isAmharic
      ? `ጉዳይዎ ወደ ሰው ድጋፍ ሰጪ ወኪሎቻችን ተላልፏል። አንድ ወኪል ሂሳብዎን መርምሮ እዚህ ቀጥታ ምላሽ ይሰጥዎታል። (ምክንያት፡ ${reason})`
      : `Your request has been forwarded to our human support agents. A verified agent will review your account and reply directly here. (Reason: ${reason})`;
    return { reply, shouldEscalate: true, reason };
  }

  // 2. Greeting
  const greetings = ['hi', 'hello', 'hey', 'good morning', 'good afternoon', 'good evening', 'selam', 'ሰላም', 'እንደምን'];
  if (greetings.some((g) => lower.startsWith(g) || lower === g || msg.startsWith(g))) {
    const reply = isAmharic
      ? `ሰላም ${user.name || 'ደንበኛ'}! ወደ ፍጣን ቤት እንኳን በደህና መጡ። ዛሬ እንዴት ልረዳዎ እችላለሁ? ስለ ገንዘብ ማስገባት፣ ማውጣት፣ ወይም ስለ ጨዋታዎቻችን መጠየቅ ይችላሉ።`
      : `Hi ${user.name || 'there'}! Welcome to Fetan Bet. How can I assist you today? Feel free to ask about deposits, withdrawals, game rules, or your account.`;
    return { reply, shouldEscalate: false };
  }

  // 3. Deposit inquiries & status
  if (lower.includes('deposit') || msg.includes('ገንዘብ ማስገባት') || msg.includes('ዲፖዚት') || msg.includes('ቴሌብር') || lower.includes('telebirr') || lower.includes('cbe')) {
    if (pendingDeposits.length > 0) {
      const p = pendingDeposits[0];
      const reply = isAmharic
        ? `በአሁኑ ሰዓት በመጠባበቅ ላይ ያለ ${p.amount / 100} ብር (${p.provider} - ማመሳከሪያ: ${p.tx_ref}) የገንዘብ ማስገቢያ አለዎት። ወኪሎቻችን በደቂቃዎች ውስጥ አረጋግጠው ያጸድቁልዎታል።`
        : `You currently have a pending deposit of ${(p.amount / 100).toLocaleString()} ETB via ${p.provider} (Ref: ${p.tx_ref}). A verified agent is reviewing it and it will be credited shortly.`;
      return { reply, shouldEscalate: false };
    }

    const reply = isAmharic
      ? `ገንዘብ ለማስገባት፦\n1. ወደ "ገንዘብ ማስገባት" ገጽ ይሂዱ።\n2. የክፍያ መንገድ ይምረጡ (ቴሌብር፣ ንግድ ባንክ፣ አቢሲኒያ ወዘተ)።\n3. መጠኑን ይምረጡና ወደ ተሰጠው ቁጥር ያስተላልፉ።\n4. ከደረሰኝ ላይ የግብይት ማመሳከሪያ ቁጥር (TX Ref) አስገብተው ይላኩ። ወኪል ወዲያውኑ ያጸድቅልዎታል።`
      : `To make a deposit:\n1. Open the "Deposit" tab in your navigation.\n2. Select your payment method (Telebirr, CBE, Bank of Abyssinia, etc.).\n3. Choose the ETB amount and transfer to the provided account.\n4. Enter the SMS transaction reference code (TX Ref) and submit. A verified agent will confirm and credit your balance.`;
    return { reply, shouldEscalate: false };
  }

  // 4. Withdrawal inquiries & status
  if (lower.includes('withdraw') || msg.includes('ገንዘብ ማውጣት') || msg.includes('ዊዝድሮው') || msg.includes('ማውጣት')) {
    if (pendingWithdrawals.length > 0) {
      const w = pendingWithdrawals[0];
      const reply = isAmharic
        ? `በአሁኑ ሰዓት በመጠባበቅ ላይ ያለ ${w.amount / 100} ብር (${w.provider} - አካውንት: ${w.account_number}) የገንዘብ ማውጫ አለዎት። ወኪል አረጋግጦ ይልክልዎታል።`
        : `You currently have a pending withdrawal request of ${(w.amount / 100).toLocaleString()} ETB via ${w.provider} to ${w.account_number}. An agent will dispatch your payout shortly.`;
      return { reply, shouldEscalate: false };
    }

    const reply = isAmharic
      ? `ገንዘብ ለማውጣት፦\n1. ወደ "ገንዘብ ማውጣት" ገጽ ይሂዱ።\n2. ክፍያ የሚቀበሉበትን ባንክ ወይም ቴሌብር ይምረጡ።\n3. ማውጣት የሚፈልጉትን መጠንና የሂሳብ ቁጥርዎን አስገብተው ይላኩ።`
      : `To request a withdrawal:\n1. Click on the "Withdraw" tab.\n2. Choose your payout provider (Telebirr, CBE, etc.).\n3. Enter the amount and your account/phone number. Our verified agents process payouts promptly.`;
    return { reply, shouldEscalate: false };
  }

  // 5. Balance inquiry
  if (lower.includes('balance') || msg.includes('ቀሪ ሂሳብ') || msg.includes('ብር አለኝ') || msg.includes('ሂሳብ')) {
    const reply = isAmharic
      ? `የአሁኑ ቀሪ ሂሳብዎ 🪙 ${balance.toLocaleString()} ብር (ክሬዲት) ነው። ተጨማሪ ክሬዲት በገንዘብ ማስገቢያ ገጽ ማስገባት ይችላሉ።`
      : `Your current verified wallet balance is 🪙 ${balance.toLocaleString()} ETB credits.`;
    return { reply, shouldEscalate: false };
  }

  // 6. Game rules inquiries
  if (lower.includes('road') || lower.includes('chicken') || msg.includes('ሮድ') || msg.includes('ዶሮ')) {
    const reply = isAmharic
      ? `ሮድ ዳሽ (Road Dash)፦ ዶሮዋ መንገዶችን እንድትሻገር ያድርጉ። በእያንዳንዱ የተሳካ እርምጃ ማባዣው ይጨምራል። መኪና ሳይገጫት በማንኛውም ሰዓት አሸናፊነትዎን አውጥተው (Cash Out) መውሰድ ይችላሉ!`
      : `Road Dash: Guide the chicken across lanes! Each safe step increases your win multiplier. You can Cash Out anytime before getting hit to lock in your winnings!`;
    return { reply, shouldEscalate: false };
  }

  if (lower.includes('mine') || msg.includes('ማይንስ') || msg.includes('ፈንጂ')) {
    const reply = isAmharic
      ? `ማይንስ (Mines)፦ ከ1 እስከ 24 ፈንጂዎችን ይምረጡ። ሳጥኖችን ሲከፍቱ አልማዝ ካገኙ ማባዣዎ ይጨምራል። ፈንጂ ሳይነኩ በማንኛውም ጊዜ አሸናፊነትዎን ወስደው መውጣት (Cash Out) ይችላሉ!`
      : `Mines: Choose between 1 and 24 mines on a 5x5 grid. Reveal diamonds to multiply your bet. You can Cash Out at any step before hitting a mine!`;
    return { reply, shouldEscalate: false };
  }

  if (lower.includes('plinko') || msg.includes('ፕሊንኮ')) {
    const reply = isAmharic
      ? `ፕሊንኮ (Plinko)፦ ኳሱን ይልቀቁት። በችንካሮች መካከል እየተወዛወዘ ከስር ባሉ የማባዣ ሳጥኖች ውስጥ ይገባል!`
      : `Plinko: Drop the ball through pegs into prize multiplier buckets at the bottom. Choose between 8 to 16 rows and Low/Medium/High risk!`;
    return { reply, shouldEscalate: false };
  }

  if (lower.includes('keno') || msg.includes('ኬኖ')) {
    const reply = isAmharic
      ? `ኬኖ (Keno)፦ ከ1 እስከ 80 ባሉ ቁጥሮች ውስጥ እስከ 10 እድለኛ ቁጥሮችን ይምረጡ። 20 ቁጥሮች ሲወጡ ያዛመዱት ቁጥር በበዛ ቁጥር ትልቅ ሽልማት ያገኛሉ!`
      : `Keno: Pick up to 10 lucky numbers from 1 to 80. Twenty numbers are drawn. The more matching numbers you hit, the higher your payout multiplier!`;
    return { reply, shouldEscalate: false };
  }

  if (lower.includes('bingo') || msg.includes('ቢንጎ')) {
    const reply = isAmharic
      ? `የኢትዮጵያ ቢንጎ (Ethiopian Bingo)፦ በባህላዊ የአማርኛ ቁጥሮች የሚጫወት 5x5 ካርድ ነው። ቁጥሮቹ ሲሳሉ ረድፍ፣ ዓምድ ወይም ሰያፍ ከሞሉ ቢንጎ ብለው ያሸንፋሉ!`
      : `Ethiopian Bingo: A traditional 5x5 bingo card featuring Amharic numerals. Complete a full horizontal row, vertical column, or diagonal line to win ቢንጎ!`;
    return { reply, shouldEscalate: false };
  }

  if (lower.includes('roulette') || msg.includes('ሩሌት')) {
    const reply = isAmharic
      ? `ሩሌት (Roulette)፦ ነጠላ ቁጥር (0–36 ለ36x ማባዣ)፣ ቀይ/ጥቁር (2x) ወይም ጎዶሎ/ጥንድ (2x) መርጠው ጎማውን ያሽከርክሩ!`
      : `Roulette: Pick a single number (36x payout), color (Red/Black for 2x), or Parity (Odd/Even for 2x) and spin the wheel!`;
    return { reply, shouldEscalate: false };
  }

  if (lower.includes('star') || lower.includes('slot') || msg.includes('ስታር') || msg.includes('ስፒን')) {
    const reply = isAmharic
      ? `ስታር ስፒን (Star Spin)፦ 3 ሪል ያለው የቁማር ማሽን ነው። ኮከብ (Star Wild) ምልክት ማንኛውንም ምልክት ተክቶ ትልቅ ድል ያስገኛል!`
      : `Star Spin: A classic 3-reel casino slot. Match three symbols across the payline, with Star Wilds substituting for any symbol for mega wins!`;
    return { reply, shouldEscalate: false };
  }

  // 7. Security / credentials reminder
  if (lower.includes('password') || lower.includes('pin') || lower.includes('otp') || msg.includes('የይለፍ ቃል') || msg.includes('ፓስወርድ')) {
    const reply = isAmharic
      ? `ማሳሰቢያ፦ የይለፍ ቃልዎን፣ የባንክ ፒንዎን ወይም ሚስጥራዊ ቁጥሮች በቻት ውስጥ በፍጹም አያጋሩ። ፍጣን ቤት የይለፍ ቃልዎን አይጠይቅዎትም።`
      : `Security Reminder: Never share your account password, PIN, or OTP in this chat. Fetan Bet staff will never ask for your confidential password.`;
    return { reply, shouldEscalate: false };
  }

  // 8. General fallback & offer to escalate
  const fallback = isAmharic
    ? `ጥያቄዎ ግልጽ አልሆነልኝም። እባክዎ እንደገና ይግለጹልኝ፣ ወይም ከፈለጉ "ወኪል አገናኘኝ" ብለው በመጻፍ ከእውነተኛ የደንበኞች ድጋፍ ሰጪ ወኪል ጋር በቀጥታ መነጋገር ይችላሉ።`
    : `I didn't quite catch that. Could you rephrase your question? If you prefer to speak directly with our team, simply type "agent" or "human support" and I will escalate your ticket right away.`;
  return { reply: fallback, shouldEscalate: false };
}

module.exports = { getAiResponse };
