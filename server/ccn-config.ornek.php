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
  // Fotoğraftan isim okuma için yapay zekâ (Anthropic). Anahtar girilirse yüklenen
  // vardiya listelerindeki isimler sunucuda yapay zekâ ile okunur (çok daha doğru).
  // Boş bırakılırsa yalnızca cihazdaki zayıf okuma kullanılır. console.anthropic.com'dan alınır.
  'ai_key' => '',
  'ai_model' => 'claude-3-5-sonnet-20241022',
];
