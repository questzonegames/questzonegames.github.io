// ===== Anagram Quest — curated country/city name data =====
//
// A word validator that also wants to accept real place names needs a
// trustworthy source for "is this actually a country/city" — arbitrary
// capitalized strings are NOT acceptable (see isValidAnagramQuestWord in
// anagram-quest.js). Rather than call an external geocoding API per
// submission (slow, rate-limited, and pointless for a fixed, small set of
// well-known names), this is a small curated local list, checked the same
// way the dictionary itself is: an exact, case-insensitive Set lookup.
//
// Scope on purpose: genuine, widely-recognised countries and major cities
// only, as single unbroken words (matching how the game builds a
// submission — one tile click at a time, never multi-word). No people's
// names, companies, or fictional places.
(function () {
  const COUNTRIES = [
    'SPAIN','FRANCE','CANADA','JAPAN','CHINA','INDIA','BRAZIL','MEXICO','EGYPT',
    'KENYA','CHAD','CUBA','PERU','CHILE','ITALY','GREECE','TURKEY','POLAND',
    'RUSSIA','UKRAINE','SWEDEN','NORWAY','FINLAND','DENMARK','IRELAND','ICELAND',
    'PORTUGAL','AUSTRIA','BELGIUM','GERMANY','SWITZERLAND','NETHERLANDS',
    'THAILAND','VIETNAM','MALAYSIA','INDONESIA','PHILIPPINES','PAKISTAN',
    'BANGLADESH','NEPAL','MONGOLIA','KAZAKHSTAN','UZBEKISTAN','ARMENIA',
    'GEORGIA','ISRAEL','JORDAN','LEBANON','SYRIA','IRAQ','IRAN','YEMEN','OMAN',
    'QATAR','KUWAIT','MOROCCO','ALGERIA','TUNISIA','LIBYA','SUDAN','ETHIOPIA',
    'SOMALIA','UGANDA','TANZANIA','ZAMBIA','ZIMBABWE','NAMIBIA','BOTSWANA',
    'MOZAMBIQUE','ANGOLA','NIGERIA','GHANA','SENEGAL','CAMEROON','GABON',
    'RWANDA','MALAWI','LESOTHO','ESWATINI','MADAGASCAR','MALI','NIGER','TOGO',
    'BENIN','LIBERIA','GAMBIA','GUINEA','ERITREA','DJIBOUTI','COMOROS',
    'SEYCHELLES','MAURITIUS','CYPRUS','MALTA','MONACO','ANDORRA','LIECHTENSTEIN',
    'LUXEMBOURG','SLOVENIA','SLOVAKIA','CROATIA','SERBIA','MONTENEGRO','KOSOVO',
    'ALBANIA','BULGARIA','ROMANIA','MOLDOVA','BELARUS','LITHUANIA','LATVIA',
    'ESTONIA','PANAMA','HONDURAS','GUATEMALA','NICARAGUA','COLOMBIA','ECUADOR',
    'VENEZUELA','URUGUAY','PARAGUAY','ARGENTINA','BOLIVIA','SURINAME','GUYANA',
    'JAMAICA','HAITI','BAHAMAS','BARBADOS','DOMINICA','GRENADA','BELIZE',
    'AUSTRALIA','ZEALAND','FIJI','SAMOA','TONGA','PALAU','KIRIBATI','VANUATU',
    'BHUTAN','MALDIVES','BRUNEI','TAIWAN','CAMBODIA','MYANMAR','LAOS',
    'AFGHANISTAN','TAJIKISTAN','TURKMENISTAN','KYRGYZSTAN','AZERBAIJAN'
  ];

  const CITIES = [
    'LONDON','PARIS','MADRID','BERLIN','ROME','TOKYO','DUBLIN','LISBON','VIENNA',
    'ATHENS','CAIRO','DELHI','MOSCOW','OSLO','TAIPEI','SEOUL','BOSTON','DALLAS',
    'DENVER','DETROIT','HOUSTON','ORLANDO','PHOENIX','AUSTIN','MIAMI','ATLANTA',
    'TORONTO','OTTAWA','CALGARY','MONTREAL','VANCOUVER','WARSAW','PRAGUE',
    'BUDAPEST','BUCHAREST','BELGRADE','ZAGREB','HELSINKI','STOCKHOLM',
    'COPENHAGEN','BRUSSELS','AMSTERDAM','ZURICH','GENEVA','MUNICH','HAMBURG',
    'COLOGNE','FRANKFURT','NAPLES','MILAN','TURIN','VENICE','FLORENCE',
    'SEVILLE','VALENCIA','PORTO','RIYADH','DUBAI','DOHA','AMMAN','BEIRUT',
    'BAGHDAD','TEHRAN','KARACHI','LAHORE','MUMBAI','CHENNAI','KOLKATA',
    'BANGKOK','HANOI','MANILA','JAKARTA','SINGAPORE','SHANGHAI','BEIJING',
    'NANJING','OSAKA','KYOTO','NAGOYA','YOKOHAMA','BUSAN','SYDNEY','MELBOURNE',
    'PERTH','BRISBANE','AUCKLAND','WELLINGTON','LAGOS','NAIROBI','ACCRA',
    'TUNIS','ALGIERS','RABAT','LUANDA','MAPUTO','HARARE','LUSAKA','KAMPALA',
    'KIGALI','GENEVA','BERN','SOFIA','SKOPJE','TIRANA','MINSK','KYIV','RIGA',
    'VILNIUS','TALLINN','ANKARA','ISTANBUL','IZMIR','IZMIT','QUITO','LIMA',
    'BOGOTA','CARACAS','SANTIAGO','MONTEVIDEO','ASUNCION','MANAGUA','PANAMA'
  ];

  const countrySet = new Set(COUNTRIES.map((w) => w.toUpperCase()));
  const citySet = new Set(CITIES.map((w) => w.toUpperCase()));

  function isCountryName(word) {
    return typeof word === 'string' && countrySet.has(word.toUpperCase());
  }
  function isCityName(word) {
    return typeof word === 'string' && citySet.has(word.toUpperCase());
  }

  window.QZAnagramGeo = { COUNTRIES, CITIES, isCountryName, isCityName };
})();
