from __future__ import annotations

from server.layouts import (
    LayoutBackground,
    LayoutCanvas,
    LayoutCaptionArea,
    LayoutDefinition,
    LayoutFrame,
    LayoutShapeItem,
    LayoutTextItem,
    LayoutVideoItem,
    PixelRect,
    prepare_layout,
)


def create_test_layout() -> LayoutDefinition:
    return LayoutDefinition(
        id="test",
        name="Test layout",
        version=1,
        description=None,
        author=None,
        tags=("example",),
        canvas=LayoutCanvas(
            width=1080,
            height=1920,
            background=LayoutBackground(kind="blur", radius=45, opacity=0.6, brightness=0.55),
        ),
        caption_area=LayoutCaptionArea(
            frame=LayoutFrame(x=0.05, y=0.75, width=0.9, height=0.2),
            align="left",
            max_lines=2,
            wrap_width=0.6,
        ),
        items=(
            LayoutVideoItem(
                id="primary",
                kind="video",
                frame=LayoutFrame(x=0.1, y=0.1, width=0.8, height=0.5),
                z_index=5,
            ),
            LayoutTextItem(
                id="title",
                kind="text",
                content="Headline",
                frame=LayoutFrame(x=0.15, y=0.65, width=0.7, height=0.1),
                z_index=10,
            ),
            LayoutShapeItem(
                id="backdrop",
                kind="shape",
                frame=LayoutFrame(x=0.08, y=0.08, width=0.84, height=0.54),
                color="#222222",
                z_index=1,
            ),
        ),
    )


def test_prepare_layout_converts_normalised_frames_to_pixels() -> None:
    layout = create_test_layout()
    prepared = prepare_layout(layout)

    assert prepared.width == 1080
    assert prepared.height == 1920

    # Items should be sorted by z-index
    assert [item.item.id for item in prepared.videos] == ["primary"]
    assert [item.item.id for item in prepared.texts] == ["title"]
    assert [item.item.id for item in prepared.shapes] == ["backdrop"]

    video_target = prepared.videos[0].target
    assert isinstance(video_target, PixelRect)
    assert video_target == PixelRect(x=108, y=192, width=864, height=960)

    text_target = prepared.texts[0].target
    assert text_target == PixelRect(x=162, y=1248, width=756, height=192)

    shape_target = prepared.shapes[0].target
    assert shape_target == PixelRect(x=86, y=154, width=907, height=1037)


def test_prepare_layout_clamps_out_of_range_values() -> None:
    layout = LayoutDefinition(
        id="clamped",
        name="Clamped",
        version=1,
        canvas=LayoutCanvas(
            width=640,
            height=640,
            background=LayoutBackground(kind="color", color="#000000"),
        ),
        caption_area=LayoutCaptionArea(
            frame=LayoutFrame(x=-0.2, y=0.9, width=1.5, height=0.4),
            align="center",
        ),
        items=(
            LayoutVideoItem(
                id="primary",
                kind="video",
                frame=LayoutFrame(x=-0.1, y=-0.1, width=1.3, height=1.3),
                z_index=0,
            ),
        ),
    )

    prepared = prepare_layout(layout)

    # Caption frame should be clamped within canvas bounds
    assert prepared.caption_rect == PixelRect(x=0, y=576, width=640, height=64)

    # Video frame clamps to full canvas dimensions
    assert prepared.videos[0].target == PixelRect(x=0, y=0, width=640, height=640)
