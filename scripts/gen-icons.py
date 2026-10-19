#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Google AI Studio 汉化助手 - 图标生成脚本
使用 Pillow 生成 16x16, 32x32, 48x48, 128x128 像素的扩展图标。
设计：圆角矩形紫色→蓝色渐变底 + 白色“中”字。
支持 4x 超采样抗锯齿与多重字体/几何降级策略。
"""

import os
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

# 目标尺寸列表
ICON_SIZES = [16, 32, 48, 128]

# 渐变配色：紫色 (#6D28D9) -> 蓝色 (#2563EB)
COLOR_START = (109, 40, 217)   # Deep Purple
COLOR_END   = (37, 99, 235)    # Vibrant Blue
COLOR_TEXT  = (255, 255, 255)  # Pure White

def get_font_path():
    """尝试定位系统中的中文字体"""
    windir = os.environ.get("WINDIR", "C:\\Windows")
    font_candidates = [
        os.path.join(windir, "Fonts", "msyhbd.ttc"),  # 微软雅黑粗体
        os.path.join(windir, "Fonts", "msyh.ttc"),    # 微软雅黑常规
        os.path.join(windir, "Fonts", "simhei.ttf"),   # 黑体
        "/System/Library/Fonts/PingFang.ttc",          # macOS
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", # Linux
    ]
    for p in font_candidates:
        if os.path.exists(p):
            return p
    return None

def create_gradient_image(width, height, start_color, end_color):
    """生成对角线线性渐变图像"""
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    # 逐像素或逐行插值计算对角线渐变
    # 为提升性能与平滑度，计算归一化距离 (x + y) / (w + h)
    max_dist = width + height
    pixels = img.load()
    for y in range(height):
        for x in range(width):
            ratio = (x + y) / max_dist
            r = int(start_color[0] + (end_color[0] - start_color[0]) * ratio)
            g = int(start_color[1] + (end_color[1] - start_color[1]) * ratio)
            b = int(start_color[2] + (end_color[2] - start_color[2]) * ratio)
            pixels[x, y] = (r, g, b, 255)
    return img

def draw_geometric_zhong(draw, bbox, color):
    """
    当无合适中文字体时，作为兜底绘制几何级高精度的“中”字。
    bbox: (left, top, right, bottom)
    """
    bx0, by0, bx1, by1 = bbox
    bw = bx1 - bx0
    bh = by1 - by0
    stroke_w = max(int(bw * 0.12), 2)
    
    # 中间矩形框
    rect_margin_y = int(bh * 0.22)
    rect_margin_x = int(bw * 0.08)
    rect_box = [
        bx0 + rect_margin_x,
        by0 + rect_margin_y,
        bx1 - rect_margin_x,
        by1 - rect_margin_y
    ]
    draw.rounded_rectangle(rect_box, radius=max(int(bw * 0.06), 1), outline=color, width=stroke_w)
    
    # 垂直贯穿中线
    cx = (bx0 + bx1) // 2
    draw.line([cx, by0, cx, by1], fill=color, width=stroke_w)

def generate_base_icon(render_size, font_path):
    """在超采样画布上绘制母版图标"""
    canvas = Image.new("RGBA", (render_size, render_size), (0, 0, 0, 0))
    
    # 1. 创建渐变底图
    gradient = create_gradient_image(render_size, render_size, COLOR_START, COLOR_END)
    
    # 2. 创建圆角矩形遮罩 (半径约 22%)
    radius = int(render_size * 0.22)
    mask = Image.new("L", (render_size, render_size), 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.rounded_rectangle([0, 0, render_size, render_size], radius=radius, fill=255)
    
    # 3. 将遮罩应用于渐变底图
    canvas.paste(gradient, (0, 0), mask)
    
    # 4. 绘制中心微发光/轻微内阴影与白色“中”字
    draw = ImageDraw.Draw(canvas)
    
    font_loaded = False
    if font_path:
        try:
            # 字体大小约为画布宽度的 62%
            font_size = int(render_size * 0.62)
            font = ImageFont.truetype(font_path, font_size, index=0)
            
            # 精确测量字符边界
            text = "中"
            bbox = draw.textbbox((0, 0), text, font=font)
            text_w = bbox[2] - bbox[0]
            text_h = bbox[3] - bbox[1]
            
            # 计算居中坐标 (微调垂直视觉居中)
            x = (render_size - text_w) / 2 - bbox[0]
            y = (render_size - text_h) / 2 - bbox[1] - (render_size * 0.015)
            
            draw.text((x, y), text, font=font, fill=COLOR_TEXT)
            font_loaded = True
        except Exception as e:
            print(f"[提示] 加载字体失败 ({e})，启用几何矢量绘制。")
    
    if not font_loaded:
        # 几何图形兜底
        margin = int(render_size * 0.22)
        bbox = (margin, margin, render_size - margin, render_size - margin)
        draw_geometric_zhong(draw, bbox, COLOR_TEXT)
        
    return canvas

def main():
    script_dir = Path(__file__).resolve().parent
    project_root = script_dir.parent
    icons_dir = project_root / "icons"
    icons_dir.mkdir(parents=True, exist_ok=True)
    
    print("=" * 60)
    print("Google AI Studio 汉化助手 - 图标生成器")
    print(f"项目目录: {project_root}")
    print(f"图标输出: {icons_dir}")
    print("=" * 60)
    
    font_path = get_font_path()
    if font_path:
        print(f"[字体] 使用系统字体: {font_path}")
    else:
        print("[字体] 未检测到系统字体，采用高精几何中文字符绘制")
        
    # 母版渲染采用 512px 超采样以确保缩小至 16/32/48/128 时均具有极佳边缘平滑度
    master_render_size = 512
    master_img = generate_base_icon(master_render_size, font_path)
    
    generated_files = []
    
    print("\n[开始生成各规格 PNG 图标]")
    for size in ICON_SIZES:
        out_path = icons_dir / f"icon{size}.png"
        
        # 对于 16/32/48 特别优化的重采样
        if size == master_render_size:
            resized_img = master_img
        else:
            resized_img = master_img.resize((size, size), resample=Image.Resampling.LANCZOS)
        
        # 保存为 PNG
        resized_img.save(out_path, format="PNG", optimize=True)
        file_size = out_path.stat().st_size
        print(f"  -> 生成 {out_path.name:12} 尺寸: {size}x{size} px | 文件大小: {file_size:,} 字节")
        generated_files.append((out_path, size))
        
    print("\n[正在执行图像尺寸与格式完整性验证...]")
    all_ok = True
    for path, expected_size in generated_files:
        with Image.open(path) as img:
            w, h = img.size
            mode = img.mode
            fmt = img.format
            if (w, h) == (expected_size, expected_size) and fmt == "PNG":
                status = "PASSED"
            else:
                status = "FAILED"
                all_ok = False
            print(f"  [{status}] {path.name}: 规格={w}x{h}, 格式={fmt}, 色彩模式={mode}")
            
    print("=" * 60)
    if all_ok:
        print("所有图标已成功生成并校验通过！")
    else:
        print("错误: 图标校验存在异常！")
        sys.exit(1)

if __name__ == "__main__":
    main()
