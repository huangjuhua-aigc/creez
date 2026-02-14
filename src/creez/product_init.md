我们来开始一个新的项目。
项目是一个本地的应用，用户可以利用agent来完成一些内容创作的任务，重要的一点是用户可以看到并且接入本地的文件。后期会加入一些定时任务，gateway接入等功能。我们先来做一个mvp版本。

mvp包括的功能有配置页面和主页面。整体的页面以白色素色为主，不要出现紫色和绿色。

## 配置页面：
用户第一次打开页面之后，如果发现配置是空的，需要让用户进行配置。
配置项包括模型配置和工作目录。
模型配置中，用户需要提供模型供应商，apikey和模型的名字。
工作目录可以打开一个文件目录， 供用户选择
配置完成之后，进入主页面。

配置的内容写在~/user/.creez/config.json。

## 主页面
主页面是是一个类似vs code的形式，左中右分三列，左边是文件目录，显示用户指定文件目录下的文件。中间是一个工作面板。右边是一个对话框。

### 左边是文件目录
参考vs code的文件目录，鼠标右键点击，出现一个菜单，支持一些常规的文件和文件夹的添加，移动，删除，复制路径，重命名等操作。另外支持把文件拖拽到右边的对话框，右边的对话框，出现@该文件名的一个特殊显示框。用户点击文件中的文件，则在中间的工作面板中显示该文件内容。
支持的文件类型包括：
doc/docx
xlsx/xls
pdf文件
mp4/webm/mov等视频文件
mp3/wav/ogg等音频文件
png/jpg/jpeg/gif/webp/svg等图片文件
md/txt/json/yaml/xml/csv等文本文件
ppt/pptx（只读预览）
zip/rar等压缩文件（只读信息）
这些文件的显示都可以在那时用node里面的类来显示
另外一个是我们应用自定义的文件类型，叫scene_board和time_line。在工作面板中，会具体解释如何显示。

### 中间工作面板
中间的工作面板主要用来显示和编辑用户在文件目录选择的文件。
文本文件，scene_board和time_line支持显示和编辑，其他文件只支持显示，更多的功能后续再添加。
顶部有文件tab。用户


这两个文件的显示可以参考
D:\code\LightOn\src\mcp_frontend\components\creative-panel\scene-board.tsx
D:\code\LightOn\src\mcp_frontend\components\creative-panel\timeline-editor.tsx


### 右边的对话框
支持用户和agent聊天，返回对话和执行任务。后端使用pi-mono（https://github.com/badlogic/pi-mono）进行agent session管理，内容回复，和工具调用。需要支持用户自定义skills。使用流式返回。
也支持用户在对话框输入@的时候，自动下拉出当前工作空间中的文件后端，显示用户最近打开的三个文件。支持用户上传图片和视频等多模态文件。右侧有一个发送按钮。

内容流式返回。


整个项目使用nodejs + electron框架，利用ipc实现render进程和主进程的通信。   