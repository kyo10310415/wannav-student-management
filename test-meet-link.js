// テスト用スクリプト

// 実際のイベント説明文（サンプル）
const testDescription = `<b>予約者:</b>
さくまみわ
karenkaren.hoshiya61@gmail.com
<br><b>学籍番号</b>
OLTS251122-CJ`;

console.log('説明文:', testDescription);
console.log('');

// String変換
const descStr = String(testDescription);
console.log('String変換後:', descStr);
console.log('');

// パターン1: https://meet.google.com/xxx-xxxx-xxx
let match = descStr.match(/https?:\/\/meet\.google\.com\/[a-z-]+/i);
console.log('パターン1マッチ:', match);

// パターン2: meet.google.com/xxx-xxxx-xxx (httpsなし)
match = descStr.match(/meet\.google\.com\/[a-z-]+/i);
console.log('パターン2マッチ:', match);

console.log('');
console.log('結論: 説明文にMeetリンクが含まれていない');
