-- Run this once in your Azure SQL database.
-- This creates the table used by GET/POST /api/belt/events.

IF OBJECT_ID('dbo.BeltEvents', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.BeltEvents (
    Id           INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    DeviceId     NVARCHAR(64)  NOT NULL,
    EventType    NVARCHAR(32)  NOT NULL,
    GateState    NVARCHAR(16)  NOT NULL,
    BeltState    NVARCHAR(16)  NOT NULL,
    QrText       NVARCHAR(2048) NULL,
    Note         NVARCHAR(512)  NULL,
    CreatedAtUtc DATETIME2(3)   NOT NULL CONSTRAINT DF_BeltEvents_CreatedAtUtc DEFAULT (SYSUTCDATETIME())
  );

  CREATE INDEX IX_BeltEvents_CreatedAtUtc ON dbo.BeltEvents(CreatedAtUtc DESC, Id DESC);
END

