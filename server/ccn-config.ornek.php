<?php
// ÖRNEK ayar dosyası. Bunu sunucuda, web klasörünün BİR ÜST klasörüne "ccn-config.php" adıyla kaydedin
// (ör. public_html'in yanına) ve değerleri doldurun. Bu dosya GitHub'a girmez.
return [
  'db_host' => 'localhost',
  'db_name' => 'u123456789_vardiya',   // hPanel → Veritabanları'ndaki tam ad
  'db_user' => 'u123456789_vardiya',
  'db_pass' => 'VERITABANI-SIFRESI',
  // 64 karakterlik rastgele gizli anahtar. TC ve telefonlar bununla tek yönlü şifrelenir:
  // BİR KEZ belirlenir, sonra DEĞİŞTİRİLMEZ (değişirse kimse giriş yapamaz).
  'pepper' => 'BURAYA-64-KARAKTERLIK-RASTGELE-ANAHTAR',
  // kurulum.php'de ilk yöneticiyi oluştururken sorulur
  'setup_key' => 'BURAYA-KURULUM-ANAHTARI',
  // web paneli farklı bir adresten açılacaksa (gerekmez)
  'origins' => [],
  // Fotoğraftan isim okuma için yapay zekâ anahtarı. Girilirse yüklenen vardiya
  // listelerindeki isimler sunucuda yapay zekâ ile okunur (çok daha doğru).
  // İki seçenek (anahtarın başına göre otomatik seçilir):
  //   - Gemini (ÜCRETSİZ): aistudio.google.com/apikey → "AIza..." ile başlar
  //   - Claude (ücretli):  console.anthropic.com → "sk-ant-..." ile başlar
  // Boş bırakılırsa yalnızca cihazdaki zayıf okuma kullanılır.
  // Not: Anahtarı dosyaya yazmak yerine DEV panelinden (/livadmin → Yapay zekâ) de girebilirsin.
  'ai_key' => '',
  // İsteğe bağlı: model. Boşsa Gemini için gemini-2.0-flash, Claude için claude-3-5-sonnet kullanılır.
  'ai_model' => '',
];
