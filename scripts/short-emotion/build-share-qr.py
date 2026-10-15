# 生成分享长图 / 小卡底部的二维码（public/short-emotion/qr-site.svg）。
# 网址改了再运行一次：pip install qrcode && python3 scripts/short-emotion/build-share-qr.py
import qrcode

URL = "https://lfjmwl.com"  # 已登录进看板，未登录到介绍页（middleware.js 分流）
qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, border=2, box_size=1)
qr.add_data(URL)
qr.make(fit=True)
matrix = qr.get_matrix()
size = len(matrix)
path = "".join(f"M{x},{y}h1v1h-1z" for y, row in enumerate(matrix) for x, on in enumerate(row) if on)
svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" shape-rendering="crispEdges" role="img" aria-label="{URL}">
<!-- 分享图底部二维码：{URL}（已登录进看板，未登录到介绍页）。由 scripts/short-emotion/build-share-qr.py 生成 -->
<rect width="{size}" height="{size}" fill="#ffffff"/><path fill="#121417" d="{path}"/></svg>
'''
with open("public/short-emotion/qr-site.svg", "w") as file:
    file.write(svg)
print(f"qr-site.svg: {size}×{size} modules → {URL}")
