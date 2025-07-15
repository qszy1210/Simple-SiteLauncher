// icon.js - 生成简单的图标
document.addEventListener('DOMContentLoaded', function() {
  // 创建一个Canvas元素
  const canvas = document.createElement('canvas');
  const sizes = [16, 32, 48, 128]; // 需要的图标尺寸

  // 生成每个尺寸的图标
  sizes.forEach(size => {
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // 绘制背景
    const gradient = ctx.createLinearGradient(0, 0, size, size);
    gradient.addColorStop(0, '#4facfe');
    gradient.addColorStop(1, '#00f2fe');

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.roundRect(0, 0, size, size, size * 0.2); // 圆角矩形
    ctx.fill();

    // 绘制闪电图标
    const padding = size * 0.2;
    const iconWidth = size - padding * 2;
    const iconHeight = size - padding * 2;

    ctx.fillStyle = 'white';
    ctx.beginPath();
    ctx.moveTo(size * 0.6, padding);
    ctx.lineTo(size * 0.4, size * 0.5);
    ctx.lineTo(size * 0.55, size * 0.5);
    ctx.lineTo(size * 0.4, size - padding);
    ctx.lineTo(size * 0.6, size * 0.5);
    ctx.lineTo(size * 0.45, size * 0.5);
    ctx.closePath();
    ctx.fill();

    // 转换为图片并下载
    const link = document.createElement('a');
    link.download = `icon${size}.png`;
    link.href = canvas.toDataURL('image/png');

    // 将链接添加到页面上
    document.body.appendChild(link);
    console.log(`已创建 icon${size}.png，请右键点击并"另存为"下载`);
  });

  // 显示说明
  const instructions = document.createElement('div');
  instructions.innerHTML = `
    <h1>图标生成器</h1>
    <p>已生成以下图标文件，请右键点击每个链接并选择"另存为"来下载：</p>
    <ul>
      ${sizes.map(size => `<li><a id="icon${size}" href="#">icon${size}.png</a></li>`).join('')}
    </ul>
    <p>下载后，将这些文件放在扩展目录中，然后更新manifest.json文件。</p>
  `;
  document.body.appendChild(instructions);

  // 为每个链接添加点击事件
  sizes.forEach(size => {
    const iconLink = document.getElementById(`icon${size}`);
    iconLink.href = canvas.toDataURL('image/png');
    iconLink.addEventListener('click', function(e) {
      // 不阻止默认行为，允许下载
    });
  });
});