import type { Lang } from "./layouts";

// Small bundled vocabularies (decision D13): most common words first, rank is the frequency prior.
const EN = `the be to of and a in that have i it for not on with he as you do at this but his by from they we say her she or an will my one all would there their what so up out if about who get which go me when make can like time no just him know take people into year your good some could them see other than then now look only come its over think also back after use two how our work first well way even new want because any these give day most us is was are were been has had did said each tell does set three want air play small end put home read hand port large spell add even land here must big high such follow act why ask men change went light kind off need house picture try again animal point mother world near build self earth father head stand own page should country found answer school grow study still learn plant cover food sun four between state keep eye never last let thought city tree cross farm hard start might story saw far sea draw left late run press close night real life few north open seem together next white children begin got walk example ease paper group always music those both mark often letter until mile river car feet care second book carry took science eat room friend began idea fish mountain stop once base hear horse cut sure watch color face wood main enough plain girl usual young ready above ever red list though feel talk bird soon body dog family direct pose leave song measure door product black short numeral class wind question happen complete ship area half rock order fire south problem piece told knew pass since top whole king space heard best hour better true during hundred five remember step early hold west ground interest reach fast verb sing listen six table travel less morning ten simple several vowel toward war lay against pattern slow center love person money serve appear road map rain rule govern pull cold notice voice unit power town fine certain fly fall lead cry dark machine note wait plan figure star box noun field rest correct able pound done beauty drive stood contain front teach week final gave green oh quick develop ocean warm free minute strong special mind behind clear tail produce fact street inch multiply nothing course stay wheel full force blue object decide surface deep moon island foot system busy test record boat common gold possible plane stead dry wonder laugh thousand ago ran check game shape equate hot miss brought heat snow tire bring yes distant fill east paint language among hello world please thanks meeting tomorrow today project working message email file folder window screen desktop keyboard typing computer code build test release merge branch commit review deploy server`.split(/\s+/);

const UK = `і в не на що я з він а до як це вона по але ми за те від так його для вони ви ще мене бо та все там тут вже чи якщо коли тільки мій ти його вам нас тому цей де без над про під при через між після перед дуже можна треба буде було були був була є немає привіт дякую будь ласка добре робота сьогодні завтра вчора проект програма друг місто людина люди час рік день ніч життя слово справа місце країна світ рука голова очі земля вода дім сім'я мати батько син дочка брат сестра школа книга мова питання відповідь правда життя робити бачити знати хотіти могти сказати говорити писати читати думати йти їхати жити любити мати давати брати ставити стояти сидіти працювати відкрити закрити почати закінчити зробити перевірити написати прочитати відправити отримати знайти залишити повернутися запитати відповісти допомогти купити продати платити вчора зараз потім завжди ніколи іноді часто разом окремо швидко повільно гарний новий старий великий малий високий довгий короткий добрий поганий перший останній інший кожний весь сам такий який скільки чому куди звідки навіщо клавіатура комп'ютер екран вікно файл папка повідомлення пошта зустріч завдання сервер код тест реліз гілка`.split(/\s+/);

const LISTS: Record<Lang, string[]> = { en: EN, uk: UK };

export interface Vocab {
  words: string[];
  /** Zipf-style weight by rank */
  weight: number[];
}

const vocabs = new Map<Lang, Vocab>();
export function vocab(lang: Lang): Vocab {
  let v = vocabs.get(lang);
  if (!v) {
    const seen = new Set<string>();
    const words = LISTS[lang].filter((w) => w.length > 0 && !seen.has(w) && (seen.add(w), true));
    v = { words, weight: words.map((_, i) => 1 / (i + 4)) };
    vocabs.set(lang, v);
  }
  return v;
}
