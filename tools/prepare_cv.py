#!/usr/bin/env python3
"""Render a private, selectable-text A4 CV. Never submits or approves a resume."""
import argparse
import io
from pathlib import Path
from xml.sax.saxutils import escape

import reportlab
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, HRFlowable

from daybreak import read_json, prevent_public_plaintext, ValidationError


def render(data):
    fonts = Path(reportlab.__file__).parent / 'fonts'
    for name, filename in [('CV', 'Vera.ttf'), ('CVBold', 'VeraBd.ttf')]:
        pdfmetrics.registerFont(TTFont(name, str(fonts / filename)))
    body = ParagraphStyle('body', fontName='CV', fontSize=9.5, leading=13,
                          textColor=colors.HexColor('#27313c'), spaceAfter=4)
    heading = ParagraphStyle('heading', parent=body, fontName='CVBold', fontSize=10,
                             textColor=colors.HexColor('#243b53'), spaceBefore=12, spaceAfter=6)
    title = ParagraphStyle('title', parent=body, fontName='CVBold', fontSize=22, leading=27)
    bold = ParagraphStyle('bold', parent=body, fontName='CVBold')
    bullet = ParagraphStyle('bullet', parent=body, leftIndent=10, firstLineIndent=-8)

    def text(value):
        if not isinstance(value, str) or not value.strip():
            raise ValidationError('CV text fields must be non-empty strings')
        if any(ord(c) not in pdfmetrics.getFont('CV').face.charToGlyph for c in value):
            raise ValidationError('Unsupported CV character; use supported Latin text')
        return escape(value)

    def items(value):
        if not isinstance(value, list):
            raise ValidationError('CV collections must be lists')
        return value

    story = [Paragraph(text(data['name']), title),
             Paragraph(text(data['headline']), body),
             Paragraph(' | '.join(text(s) for s in items(data['contact'])), body),
             Spacer(1, 5), HRFlowable(width='100%', color=colors.HexColor('#243b53'))]
    if data.get('summary'):
        story.extend([Paragraph('PROFILE', heading), Paragraph(text(data['summary']), body)])
    for section in items(data['sections']):
        story.append(Paragraph(text(section['heading']).upper(), heading))
        for entry in items(section['entries']):
            if entry.get('title'):
                story.append(Paragraph(text(entry['title']), bold))
            if entry.get('detail'):
                story.append(Paragraph(text(entry['detail']), body))
            for line in items(entry.get('bullets', [])):
                story.append(Paragraph('- ' + text(line), bullet))
    output = io.BytesIO()

    def check_page(canvas, doc):
        if doc.page > 1:
            raise ValidationError('CV exceeds one page. Shorten selected content; font size is not reduced.')

    SimpleDocTemplate(output, pagesize=A4, leftMargin=42, rightMargin=42,
                      topMargin=36, bottomMargin=36, title='Curriculum Vitae',
                      author='', allowSplitting=1).build(story, onFirstPage=check_page, onLaterPages=check_page)
    return output.getvalue()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', help='Private JSON containing selected factual content')
    parser.add_argument('--output', required=True, help='Private PDF destination')
    args = parser.parse_args()
    prevent_public_plaintext(args.input)
    prevent_public_plaintext(args.output)
    result = render(read_json(args.input))
    path = Path(args.output)
    path.parent.mkdir(parents=True, exist_ok=True)
    # Exclusive creation keeps immutable versions from being accidentally overwritten.
    with path.open('xb') as target:
        path.chmod(0o600)
        target.write(result)
    print('Private one-page CV prepared. Review before registering it as approved.')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, KeyError, TypeError) as exc:
        raise SystemExit('CV preparation failed: ' + str(exc))
