# course-tools
An offline‑enabled, secure and user‑friendly course tool. It works without internet access, keeps data stored locally for safety, features low‑threshold operations and is easy to get started with, meeting the needs of various course learning and teaching scenarios.
有格式要求，不是所有课表都能直接导入。目前软件主要适配教务系统导出的 .xls/.xlsx 课表，以及软件自己的 .json 备份文件。
Excel 课表要求：
- 只读取第一个工作表；
- 表头需要能识别星期，例如：星期一、星期二……星期天；
- 至少要识别出 5 个星期列；
- 每个课程单元格最好是这种结构：
课程名称
[教师姓名]
（1-16周[01-02节]）
上课地点
班级名称
例如你之前的 1.xlsx 就属于当前支持的格式。
JSON 格式要求：
{
  "currentWeek": 1,
  "courses": [
    {
      "name": "高等数学",
      "teacher": "张老师",
      "location": "教学楼101",
      "className": "2024级1班",
      "day": 1,
      "period": {
        "start": 1,
        "end": 2
      },
      "weeks": [1, 2, 3, 4],
      "color": "#ff8e3c"
    }
  ]
}
其中：
- day：1 到 7，分别代表周一到周日；
- period.start/end：1 到 12 节；
- weeks：必须是有效周次；
- className 留空时，会被当作公共课。
以下情况可能无法导入或部分课程被跳过：
- 星期表头是英文或特殊名称；
- 课程信息没有按“课程、教师、周次节次、地点、班级”分行；
- 课程写在第二个工作表；
- 周次和节次格式完全不同；
- 课程内容使用图片、文本框或复杂合并单元格保存。
