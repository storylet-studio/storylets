#include "SStoryletStatePanel.h"
#include "StoryletLiveLink.h"

#include "StoryletDebug.h"
#include "StoryletEngine.h"
#include "StoryletSave.h"
#include "StoryletTypes.h"

#include "Editor.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/Text/STextBlock.h"
#include "Widgets/Input/SCheckBox.h"
#include "Widgets/Input/SButton.h"
#include "Widgets/Input/SComboBox.h"
#include "Widgets/Input/SEditableTextBox.h"
#include "Widgets/Input/SNumericEntryBox.h"
#include "Widgets/Input/SSearchBox.h"
#include "Widgets/Layout/SScrollBox.h"
#include "Widgets/Layout/SBox.h"
#include "Styling/CoreStyle.h"

#include "DesktopPlatformModule.h"
#include "Framework/Application/SlateApplication.h"
#include "HAL/PlatformApplicationMisc.h"
#include "Misc/FileHelper.h"
#include "Misc/MessageDialog.h"
#include "Widgets/Views/SListView.h"
#include "Widgets/Views/STableRow.h"

#define LOCTEXT_NAMESPACE "StoryletStatePanel"

namespace
{
	/** Boxes and cards read as title-or-gameId, never internal ids. */
	FString TitleOrGameId(const FString& Title, const FString& GameId)
	{
		return Title.IsEmpty() ? GameId : Title;
	}

	TArray<FString> ParseFlagsList(const FString& Text)
	{
		TArray<FString> Parts;
		Text.ParseIntoArray(Parts, TEXT(","), true);
		for (FString& P : Parts) { P.TrimStartAndEndInline(); }
		Parts.RemoveAll([](const FString& S) { return S.IsEmpty(); });
		return Parts;
	}

	/** The log panel's six filter buckets; a peek files under Deal (both are
	 *  asks). */
	int32 LogBucketOf(EStoryletLogKind Kind)
	{
		switch (Kind)
		{
			case EStoryletLogKind::Deal:
			case EStoryletLogKind::Peek:       return 0;
			case EStoryletLogKind::Play:       return 1;
			case EStoryletLogKind::Write:      return 2;
			case EStoryletLogKind::Evict:      return 3;
			case EStoryletLogKind::Turns:      return 4;
			default:                           return 5;   // Diagnostic
		}
	}
}

// ---------------------------------------------------------------------------
// SStoryletFlowLog - one retained log (design 2.3: the log
// panel in every examiner; the old port's SStoryletEngineLogPanel is the
// high-water mark). Per-kind filters, Autoscroll, Copy (the visible,
// filtered lines) and Clear; a virtualised SListView body; a poll picks up
// new entries by count + last Seq, so steady state is cheap.
// ---------------------------------------------------------------------------

class SStoryletFlowLog : public SCompoundWidget
{
public:
	// Exactly one of Session / Engine is set: a flow draws its own log, the
	// engine draws the RUN's log (every flow's events in one order, each line
	// naming its flow). A flow's own log cannot show a story action in another
	// flow moving shared state, which is why both exist
	// (design/shared-scarcity.md 8.2).
	SLATE_BEGIN_ARGS(SStoryletFlowLog) {}
		SLATE_ARGUMENT(TWeakObjectPtr<UStoryletFlow>, Session)
		SLATE_ARGUMENT(TWeakObjectPtr<UStoryletEngine>, Engine)
	SLATE_END_ARGS()

	void Construct(const FArguments& InArgs)
	{
		Session = InArgs._Session;
		Engine = InArgs._Engine;
		for (bool& bOn : BucketVisible) { bOn = true; }

		static const FText BucketLabels[6] =
		{
			LOCTEXT("LogKindDeal", "Deal"),
			LOCTEXT("LogKindPlay", "Play"),
			LOCTEXT("LogKindWrite", "Write"),
			LOCTEXT("LogKindEvict", "Evict"),
			LOCTEXT("LogKindTurns", "Turns"),
			LOCTEXT("LogKindDiag", "Diag"),
		};

		const TSharedRef<SHorizontalBox> KindRow = SNew(SHorizontalBox);
		for (int32 Bucket = 0; Bucket < 6; ++Bucket)
		{
			KindRow->AddSlot().AutoWidth().Padding(0.f, 0.f, 6.f, 0.f)
			[
				SNew(SCheckBox)
				.IsChecked_Lambda([this, Bucket]()
				{
					return BucketVisible[Bucket] ? ECheckBoxState::Checked : ECheckBoxState::Unchecked;
				})
				.OnCheckStateChanged_Lambda([this, Bucket](ECheckBoxState State)
				{
					BucketVisible[Bucket] = (State == ECheckBoxState::Checked);
					ApplyFilter();
				})
				[
					SNew(STextBlock).Text(BucketLabels[Bucket])
				]
			];
		}

		ChildSlot
		[
			SNew(SVerticalBox)
			+ SVerticalBox::Slot().AutoHeight().Padding(0.f, 0.f, 0.f, 2.f)
			[
				KindRow
			]
			+ SVerticalBox::Slot().AutoHeight().Padding(0.f, 0.f, 0.f, 4.f)
			[
				SNew(SHorizontalBox)
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.f, 0.f, 8.f, 0.f)
				[
					SNew(SCheckBox)
					.IsChecked_Lambda([this]()
					{
						return bAutoScroll ? ECheckBoxState::Checked : ECheckBoxState::Unchecked;
					})
					.OnCheckStateChanged_Lambda([this](ECheckBoxState State)
					{
						bAutoScroll = (State == ECheckBoxState::Checked);
					})
					.ToolTipText(LOCTEXT("AutoscrollTip",
						"Scroll to the latest entry on every refresh. Untick to freeze the "
						"scroll position while inspecting older entries."))
					[
						SNew(STextBlock).Text(LOCTEXT("AutoscrollLabel", "Autoscroll"))
					]
				]
				+ SHorizontalBox::Slot().AutoWidth().Padding(0.f, 0.f, 4.f, 0.f)
				[
					SNew(SButton)
					.Text(LOCTEXT("LogCopy", "Copy"))
					.ToolTipText(LOCTEXT("LogCopyTip", "Copy the visible (filtered) log to the clipboard."))
					.OnClicked_Lambda([this]()
					{
						FString Out;
						for (const TSharedPtr<FStoryletLogEntry>& E : Filtered)
						{
							Out += E->Summary;
							Out += LINE_TERMINATOR;
						}
						FPlatformApplicationMisc::ClipboardCopy(*Out);
						return FReply::Handled();
					})
				]
				+ SHorizontalBox::Slot().AutoWidth()
				[
					SNew(SButton)
					.Text(LOCTEXT("LogClear", "Clear"))
					.ToolTipText(LOCTEXT("LogClearTip",
						"Drop the retained log entries. Cosmetic - no game state changes."))
					.OnClicked_Lambda([this]()
					{
						if (UStoryletFlow* S = Session.Get()) { S->ClearLog(); }
						else if (UStoryletEngine* E = Engine.Get()) { E->ClearRunLog(); }
						Refresh();
						return FReply::Handled();
					})
				]
			]
			+ SVerticalBox::Slot().AutoHeight()
			[
				SNew(STextBlock)
				.Text(LOCTEXT("LogEmpty",
					"(empty - the session retains its log when created with bRetainLog / the log option)"))
				.ColorAndOpacity(FSlateColor::UseSubduedForeground())
				.Visibility_Lambda([this]()
				{
					return All.Num() == 0 ? EVisibility::Visible : EVisibility::Collapsed;
				})
			]
			+ SVerticalBox::Slot().FillHeight(1.f)
			[
				SAssignNew(ListView, SListView<TSharedPtr<FStoryletLogEntry>>)
				.ListItemsSource(&Filtered)
				.OnGenerateRow_Lambda([](TSharedPtr<FStoryletLogEntry> Item, const TSharedRef<STableViewBase>& Owner)
				{
					return SNew(STableRow<TSharedPtr<FStoryletLogEntry>>, Owner)
						.Padding(2.f)
						[
							SNew(STextBlock)
							.Text(FText::FromString(Item->Summary))
							.Font(FCoreStyle::GetDefaultFontStyle("Mono", 9))
						];
				})
				.SelectionMode(ESelectionMode::None)
			]
		];

		Refresh();
		// New entries arrive by count + last Seq; steady state is a cheap check.
		RegisterActiveTimer(0.25f, FWidgetActiveTimerDelegate::CreateSP(this, &SStoryletFlowLog::OnPoll));
	}

private:
	EActiveTimerReturnType OnPoll(double, float)
	{
		const TArray<FStoryletLogEntry> Now = Entries();
		const int64 LastSeq = Now.Num() > 0 ? Now.Last().Seq : -1;
		if (Now.Num() != CachedCount || LastSeq != CachedLastSeq)
		{
			Refresh();
		}
		return EActiveTimerReturnType::Continue;
	}

	/** Whichever log this widget is showing. */
	TArray<FStoryletLogEntry> Entries() const
	{
		if (UStoryletFlow* S = Session.Get()) return S->Log();
		if (UStoryletEngine* E = Engine.Get()) return E->GetRunLog();
		return TArray<FStoryletLogEntry>();
	}

	void Refresh()
	{
		All.Reset();
		for (const FStoryletLogEntry& E : Entries())
		{
			All.Add(MakeShared<FStoryletLogEntry>(E));
		}
		CachedCount = All.Num();
		CachedLastSeq = All.Num() > 0 ? All.Last()->Seq : -1;
		ApplyFilter();
	}

	void ApplyFilter()
	{
		Filtered.Reset();
		for (const TSharedPtr<FStoryletLogEntry>& E : All)
		{
			if (BucketVisible[LogBucketOf(E->Kind)])
			{
				Filtered.Add(E);
			}
		}
		if (ListView.IsValid())
		{
			ListView->RequestListRefresh();
			if (bAutoScroll && Filtered.Num() > 0)
			{
				ListView->RequestScrollIntoView(Filtered.Last());
			}
		}
	}

	TWeakObjectPtr<UStoryletFlow> Session;
	TWeakObjectPtr<UStoryletEngine> Engine;
	bool BucketVisible[6] = {};
	bool bAutoScroll = true;
	int32 CachedCount = 0;
	int64 CachedLastSeq = -1;
	TArray<TSharedPtr<FStoryletLogEntry>> All;
	TArray<TSharedPtr<FStoryletLogEntry>> Filtered;
	TSharedPtr<SListView<TSharedPtr<FStoryletLogEntry>>> ListView;
};

void SStoryletStatePanel::Construct(const FArguments& InArgs)
{
	ChildSlot
	[
		SNew(SVerticalBox)
		+ SVerticalBox::Slot().AutoHeight().Padding(10.f, 8.f, 10.f, 4.f)
		[
			SNew(SSearchBox)
			.HintText(LOCTEXT("FilterHint", "Filter properties..."))
			.OnTextChanged_Lambda([this](const FText& Text)
			{
				FilterText = Text.ToString();
				Rebuild();
			})
		]
		+ SVerticalBox::Slot().FillHeight(1.f)
		[
			SNew(SScrollBox)
			+ SScrollBox::Slot()
			[
				SAssignNew(Body, SVerticalBox)
			]
		]
	];

	ChangedHandle = FStoryletDebug::OnChanged().AddSP(this, &SStoryletStatePanel::Rebuild);
	// PostPIEStarted fires after PIE worlds finish init, so a session
	// registered in BeginPlay is already in the registry; EndPIE fires before
	// teardown, giving a clean detach edge.
	PostPIEStartedHandle = FEditorDelegates::PostPIEStarted.AddSP(
		SharedThis(this), &SStoryletStatePanel::HandlePostPIEStarted);
	EndPIEHandle = FEditorDelegates::EndPIE.AddSP(
		SharedThis(this), &SStoryletStatePanel::HandleEndPIE);
	Rebuild();

	// Poll a few times a second: cheap Signature() check, only a real
	// Rebuild() on a structural change.
	RegisterActiveTimer(0.25f, FWidgetActiveTimerDelegate::CreateSP(this, &SStoryletStatePanel::OnRefresh));
}

SStoryletStatePanel::~SStoryletStatePanel()
{
	FStoryletDebug::OnChanged().Remove(ChangedHandle);
	FEditorDelegates::PostPIEStarted.Remove(PostPIEStartedHandle);
	FEditorDelegates::EndPIE.Remove(EndPIEHandle);
}

void SStoryletStatePanel::HandlePostPIEStarted(bool /*bIsSimulating*/)
{
	Rebuild();
}

void SStoryletStatePanel::HandleEndPIE(bool /*bIsSimulating*/)
{
	Rebuild();
}

EActiveTimerReturnType SStoryletStatePanel::OnRefresh(double, float)
{
	if (Signature() != LastSignature)
	{
		Rebuild();
	}
	return EActiveTimerReturnType::Continue;
}

FString SStoryletStatePanel::Signature() const
{
	FString S = FilterText + TEXT("#");
	for (const FStoryletDebug::FEntry& E : FStoryletDebug::List())
	{
		S += E.Label + TEXT("|");
		if (UStoryletEngine* Engine = E.Engine.Get())
		{
			for (UStoryletFlow* Flow : Engine->Flows())
			{
				S += Flow->GetFlowId() + TEXT(":");
				for (const FStoryletPropertyView& R : Flow->ListProperties())
				{
					S += R.Path + TEXT(",");
				}
				S += TEXT("/");
				for (const FStoryletBoxView& B : Flow->ListBoxes())
				{
					S += B.GameId + TEXT(",");
				}
				S += TEXT("/");
				for (const FStoryletHandContents& H : Flow->Board())
				{
					S += H.Hand + TEXT(",");
				}
				S += TEXT("|");
			}
		}
		S += TEXT(";");
	}
	return S;
}

void SStoryletStatePanel::Rebuild()
{
	if (!Body.IsValid())
	{
		return;
	}
	Body->ClearChildren();
	EnumSources.Reset();
	LastSignature = Signature();

	// Where the Live Link is, when the game registered one: the same line the
	// Unity examiner has shown since the link landed, and now Godot's too, so a
	// host can tell "the editor is not listening" from "I never attached" in
	// any engine.
	if (TSharedPtr<FStoryletLiveLink> Link = FStoryletDebug::GetLink())
	{
		const FString State = Link->LinkState();
		const FString Shown = State == TEXT("connected")
			? FString::Printf(TEXT("connected, build %s"), *Link->GetBuild())
			: State;
		Body->AddSlot().AutoHeight().Padding(10.f, 4.f)
		[
			SNew(STextBlock).Text(FText::FromString(
				FString::Printf(TEXT("Live Link: %s (%s)"), *Shown, *Link->GetUrl())))
		];
	}

	TArray<FStoryletDebug::FEntry> Entries = FStoryletDebug::List();
	if (Entries.Num() == 0)
	{
		Body->AddSlot().AutoHeight().Padding(10.f)
		[
			SNew(STextBlock)
			.AutoWrapText(true)
			.Text(LOCTEXT("NoEngines",
				"No live engines. In Play mode, call RegisterForDebug(\"label\") on your "
				"UStoryletEngine (or FStoryletDebug::Register) after creating it, and every "
				"flow you open appears here with its properties, turns and board."))
		];
		return;
	}

	for (const FStoryletDebug::FEntry& E : Entries)
	{
		UStoryletEngine* Engine = E.Engine.Get();
		if (!Engine)
		{
			continue;
		}
		const TWeakObjectPtr<UStoryletEngine> WeakEngine = E.Engine;

		Body->AddSlot().AutoHeight().Padding(10.f, 10.f, 10.f, 2.f)
		[
			SNew(STextBlock)
			.Text(FText::FromString(E.Label))
			.Font(FCoreStyle::GetDefaultFontStyle("Bold", 11))
		];
		// Save/Load the whole run to a .storyletsave file (in EVERY examiner,
		// the parity rule).
		Body->AddSlot().AutoHeight().Padding(10.f, 2.f, 10.f, 2.f)
		[
			SNew(SHorizontalBox)
			+ SHorizontalBox::Slot().AutoWidth().Padding(0.f, 0.f, 6.f, 0.f)
			[
				SNew(SButton)
				.Text(LOCTEXT("SaveState", "Save State..."))
				.OnClicked_Lambda([WeakEngine]()
				{
					SStoryletStatePanel::SaveStateToFile(WeakEngine.Get());
					return FReply::Handled();
				})
			]
			+ SHorizontalBox::Slot().AutoWidth()
			[
				SNew(SButton)
				.Text(LOCTEXT("LoadState", "Load State..."))
				.OnClicked_Lambda([WeakEngine]()
				{
					SStoryletStatePanel::LoadStateFromFile(WeakEngine.Get());
					return FReply::Handled();
				})
			]
		];

		// The run's log sits with the engine, because that is whose it is: one
		// ordered stream over every flow. Each flow's section carries its own.
		Body->AddSlot().AutoHeight().Padding(10.f, 8.f, 10.f, 2.f)
		[
			SNew(STextBlock)
			.Text(LOCTEXT("RunLogSection", "Run log (every flow)"))
			.ColorAndOpacity(FSlateColor::UseSubduedForeground())
		];
		Body->AddSlot().AutoHeight().Padding(10.f, 2.f, 10.f, 6.f)
		[
			SNew(SStoryletFlowLog).Engine(WeakEngine)
		];

		// One section per open flow: a flow IS the playthrough, so its
		// properties (the merged view), clocks, board and log are what a
		// debugger wants to see - and a game with several flows gets each.
		TArray<UStoryletFlow*> OpenFlows = Engine->Flows();
		if (OpenFlows.Num() == 0)
		{
			Body->AddSlot().AutoHeight().Padding(14.f, 4.f, 10.f, 6.f)
			[
				SNew(STextBlock).Text(LOCTEXT("NoFlows", "(no open flows - call OpenFlow)"))
			];
		}
		for (UStoryletFlow* Flow : OpenFlows)
		{
			const TWeakObjectPtr<UStoryletFlow> WeakFlow = Flow;
			Body->AddSlot().AutoHeight().Padding(10.f, 8.f, 10.f, 2.f)
			[
				SNew(STextBlock)
				.Text(FText::FromString(FString::Printf(TEXT("flow: %s"), *Flow->GetFlowId())))
				.ColorAndOpacity(FSlateColor::UseSubduedForeground())
			];
			// --- the property examiner / editor --------------------------------
			Body->AddSlot().AutoHeight().Padding(10.f, 6.f, 10.f, 4.f)
			[
				SNew(STextBlock)
				.Text(LOCTEXT("PropertiesSection", "Properties"))
				.ColorAndOpacity(FSlateColor::UseSubduedForeground())
			];
			TArray<FStoryletPropertyView> Rows = Flow->ListProperties();
			int32 Shown = 0;
			for (const FStoryletPropertyView& Row : Rows)
			{
				if (!FilterText.IsEmpty() && !Row.Path.Contains(FilterText))
				{
					continue;
				}
				++Shown;
				Body->AddSlot().AutoHeight().Padding(14.f, 1.f, 10.f, 1.f)
				[
					BuildRow(WeakFlow, Row)
				];
			}
			if (Shown == 0)
			{
				Body->AddSlot().AutoHeight().Padding(16.f, 0.f, 10.f, 6.f)
				[
					SNew(STextBlock).Text(Rows.Num() == 0
						? LOCTEXT("NoProps", "(none declared)")
						: LOCTEXT("NoPropsMatch", "(none match the filter)"))
				];
			}

			// --- read-only: per-box turns (title-or-gameId, from ListBoxes) ----
			Body->AddSlot().AutoHeight().Padding(10.f, 8.f, 10.f, 4.f)
			[
				SNew(STextBlock)
				.Text(LOCTEXT("TurnsSection", "Turns (per box)"))
				.ColorAndOpacity(FSlateColor::UseSubduedForeground())
			];
			for (const FStoryletBoxView& Box : Flow->ListBoxes())
			{
				const FString BoxRef = Box.GameId;
				Body->AddSlot().AutoHeight().Padding(14.f, 1.f, 10.f, 1.f)
				[
					SNew(SHorizontalBox)
					+ SHorizontalBox::Slot().AutoWidth().Padding(0.f, 0.f, 8.f, 0.f)
					[
						SNew(SBox).WidthOverride(150.f)
						[
							SNew(STextBlock).Text(FText::FromString(TitleOrGameId(Box.Title, Box.GameId)))
						]
					]
					+ SHorizontalBox::Slot().FillWidth(1.f)
					[
						SNew(STextBlock).Text_Lambda([WeakFlow, BoxRef]()
						{
							UStoryletFlow* S = WeakFlow.Get();
							return FText::AsNumber(S ? S->GetTurn(BoxRef) : 0.0);
						})
					]
				];
			}

			// --- read-only: the board (hand gameId -> card titles) -------------
			Body->AddSlot().AutoHeight().Padding(10.f, 8.f, 10.f, 4.f)
			[
				SNew(STextBlock)
				.Text(LOCTEXT("BoardSection", "Board"))
				.ColorAndOpacity(FSlateColor::UseSubduedForeground())
			];
			for (const FStoryletHandContents& Hand : Flow->Board())
			{
				const FString HandKey = Hand.Hand;
				Body->AddSlot().AutoHeight().Padding(14.f, 1.f, 10.f, 1.f)
				[
					SNew(SHorizontalBox)
					+ SHorizontalBox::Slot().AutoWidth().Padding(0.f, 0.f, 8.f, 0.f)
					[
						SNew(SBox).WidthOverride(150.f)
						[
							SNew(STextBlock).Text(FText::FromString(HandKey))
						]
					]
					+ SHorizontalBox::Slot().FillWidth(1.f)
					[
						SNew(STextBlock)
						.AutoWrapText(true)
						.Text_Lambda([WeakFlow, HandKey]()
						{
							UStoryletFlow* S = WeakFlow.Get();
							if (!S) return FText::GetEmpty();
							for (const FStoryletHandContents& H : S->Board())
							{
								if (H.Hand != HandKey) continue;
								if (H.Cards.Num() == 0) return LOCTEXT("EmptyHand", "(empty)");
								FString Joined;
								for (int32 i = 0; i < H.Cards.Num(); ++i)
								{
									if (i > 0) Joined += TEXT(", ");
									Joined += TitleOrGameId(H.Cards[i].Title, H.Cards[i].GameId);
								}
								return FText::FromString(Joined);
							}
							return LOCTEXT("EmptyHand", "(empty)");
						})
					]
				];
			}

			// --- the session's retained log (design 2.3) ------------------------
			Body->AddSlot().AutoHeight().Padding(10.f, 8.f, 10.f, 4.f)
			[
				SNew(STextBlock)
				.Text(LOCTEXT("LogSection", "Log"))
				.ColorAndOpacity(FSlateColor::UseSubduedForeground())
			];
			Body->AddSlot().AutoHeight().Padding(14.f, 1.f, 10.f, 6.f)
			[
				SNew(SBox).HeightOverride(160.f)
				[
					SNew(SStoryletFlowLog).Session(WeakFlow)
				]
			];
		}

	}
}

TSharedRef<SWidget> SStoryletStatePanel::BuildRow(
	TWeakObjectPtr<UStoryletFlow> Session, const FStoryletPropertyView& Row)
{
	const FString Path = Row.Path;
	const FString DefaultStr = Row.Default;
	const bool bWritable = Row.bWritable;

	TSharedRef<SWidget> Editor = SNullWidget::NullWidget;

	switch (Row.Type)
	{
	case EStoryletPropertyType::Boolean:
		Editor = SNew(SCheckBox)
			.IsEnabled(bWritable)
			.IsChecked_Lambda([Session, Path]()
			{
				UStoryletFlow* S = Session.Get();
				return (S && S->GetPropertyBool(Path)) ? ECheckBoxState::Checked : ECheckBoxState::Unchecked;
			})
			.OnCheckStateChanged_Lambda([Session, Path](ECheckBoxState State)
			{
				if (UStoryletFlow* S = Session.Get()) { S->SetPropertyBool(Path, State == ECheckBoxState::Checked); }
			});
		break;

	case EStoryletPropertyType::Number:
		Editor = SNew(SNumericEntryBox<double>)
			.IsEnabled(bWritable)
			.AllowSpin(false)
			.Value_Lambda([Session, Path]() -> TOptional<double>
			{
				UStoryletFlow* S = Session.Get();
				return S ? TOptional<double>(S->GetPropertyNumber(Path)) : TOptional<double>();
			})
			.OnValueCommitted_Lambda([Session, Path](double NewValue, ETextCommit::Type)
			{
				if (UStoryletFlow* S = Session.Get()) { S->SetPropertyNumber(Path, NewValue); }
			});
		break;

	case EStoryletPropertyType::Enum:
	{
		TSharedRef<TArray<TSharedPtr<FString>>> Options = MakeShared<TArray<TSharedPtr<FString>>>();
		for (const FString& V : Row.Values) { Options->Add(MakeShared<FString>(V)); }
		EnumSources.Add(Options);

		TSharedPtr<FString> Initial;
		if (UStoryletFlow* S = Session.Get())
		{
			const FString Cur = S->GetPropertyString(Path);
			for (const TSharedPtr<FString>& O : *Options) { if (*O == Cur) { Initial = O; break; } }
		}

		Editor = SNew(SComboBox<TSharedPtr<FString>>)
			.IsEnabled(bWritable)
			.OptionsSource(&(*Options))
			.InitiallySelectedItem(Initial)
			.OnGenerateWidget_Lambda([](TSharedPtr<FString> In)
			{
				return SNew(STextBlock).Text(FText::FromString(In.IsValid() ? *In : FString()));
			})
			.OnSelectionChanged_Lambda([Session, Path](TSharedPtr<FString> In, ESelectInfo::Type)
			{
				if (In.IsValid()) { if (UStoryletFlow* S = Session.Get()) { S->SetPropertyString(Path, *In); } }
			})
			[
				SNew(STextBlock).Text_Lambda([Session, Path]()
				{
					UStoryletFlow* S = Session.Get();
					return FText::FromString(S ? S->GetPropertyString(Path) : FString());
				})
			];
		break;
	}

	case EStoryletPropertyType::Flags:
		Editor = SNew(SEditableTextBox)
			.IsEnabled(bWritable)
			.HintText(LOCTEXT("FlagsHint", "comma, separated"))
			.Text_Lambda([Session, Path]()
			{
				UStoryletFlow* S = Session.Get();
				return S ? FText::FromString(FString::Join(S->GetPropertyFlags(Path), TEXT(", "))) : FText::GetEmpty();
			})
			.OnTextCommitted_Lambda([Session, Path](const FText& Text, ETextCommit::Type)
			{
				if (UStoryletFlow* S = Session.Get()) { S->SetPropertyFlags(Path, ParseFlagsList(Text.ToString())); }
			});
		break;

	default: // String (and any unrecognised type) -> a text field.
		Editor = SNew(SEditableTextBox)
			.IsEnabled(bWritable)
			.Text_Lambda([Session, Path]()
			{
				UStoryletFlow* S = Session.Get();
				return S ? FText::FromString(S->GetPropertyString(Path)) : FText::GetEmpty();
			})
			.OnTextCommitted_Lambda([Session, Path](const FText& Text, ETextCommit::Type)
			{
				if (UStoryletFlow* S = Session.Get()) { S->SetPropertyString(Path, Text.ToString()); }
			});
		break;
	}

	const EStoryletPropertyType Type = Row.Type;
	auto ResetToDefault = [Session, Path, DefaultStr, Type]()
	{
		UStoryletFlow* S = Session.Get();
		if (!S) { return FReply::Handled(); }
		switch (Type)
		{
		case EStoryletPropertyType::Boolean: S->SetPropertyBool(Path, DefaultStr == TEXT("true")); break;
		case EStoryletPropertyType::Number:  S->SetPropertyNumber(Path, FCString::Atod(*DefaultStr)); break;
		case EStoryletPropertyType::Flags:   S->SetPropertyFlags(Path, ParseFlagsList(DefaultStr)); break;
		default: S->SetPropertyString(Path, DefaultStr); break; // String + Enum
		}
		return FReply::Handled();
	};

	return SNew(SHorizontalBox)
		+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.f, 0.f, 8.f, 0.f)
		[
			SNew(SBox).WidthOverride(210.f)
			[
				SNew(STextBlock).Text(FText::FromString(Path)).ToolTipText(FText::FromString(Path))
			]
		]
		+ SHorizontalBox::Slot().FillWidth(1.f).VAlign(VAlign_Center)
		[
			Editor
		]
		+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(6.f, 0.f, 0.f, 0.f)
		[
			SNew(SButton)
			.ToolTipText(LOCTEXT("ResetTip", "Reset to default"))
			// Disabled while the value already sits at its default.
			.IsEnabled_Lambda([Session, Path, DefaultStr, bWritable]()
			{
				UStoryletFlow* S = Session.Get();
				return bWritable && S && S->GetPropertyString(Path) != DefaultStr;
			})
			.OnClicked_Lambda(ResetToDefault)
			[
				SNew(STextBlock).Text(FText::FromString(TEXT("↺"))) // circular reset arrow
			]
		];
}

void SStoryletStatePanel::SaveStateToFile(UStoryletEngine* Engine)
{
	if (!Engine || !Engine->IsValidEngine()) return;
	IDesktopPlatform* Desktop = FDesktopPlatformModule::Get();
	if (!Desktop) return;
	TArray<FString> Files;
	const void* Parent = FSlateApplication::Get().FindBestParentWindowHandleForDialogs(nullptr);
	if (!Desktop->SaveFileDialog(Parent, TEXT("Save Storylets State"), FPaths::ProjectSavedDir(),
			TEXT("save.storyletsave"), TEXT("Storylets state (*.storyletsave)|*.storyletsave"),
			EFileDialogFlags::None, Files) || Files.Num() == 0)
	{
		return;
	}
	const FString Json = UStoryletSave::SaveStateToJson(Engine);
	if (Json.IsEmpty())
	{
		FMessageDialog::Open(EAppMsgType::Ok, LOCTEXT("SaveFail", "Could not save the state."));
		return;
	}
	FFileHelper::SaveStringToFile(Json, *Files[0], FFileHelper::EEncodingOptions::ForceUTF8WithoutBOM);
}

void SStoryletStatePanel::LoadStateFromFile(UStoryletEngine* Engine)
{
	if (!Engine || !Engine->IsValidEngine()) return;
	IDesktopPlatform* Desktop = FDesktopPlatformModule::Get();
	if (!Desktop) return;
	TArray<FString> Files;
	const void* Parent = FSlateApplication::Get().FindBestParentWindowHandleForDialogs(nullptr);
	if (!Desktop->OpenFileDialog(Parent, TEXT("Load Storylets State"), FPaths::ProjectSavedDir(), TEXT(""),
			TEXT("Storylets state (*.storyletsave)|*.storyletsave"), EFileDialogFlags::None, Files)
		|| Files.Num() == 0)
	{
		return;
	}
	FString Text;
	if (!FFileHelper::LoadFileToString(Text, *Files[0]))
	{
		FMessageDialog::Open(EAppMsgType::Ok, LOCTEXT("LoadReadFail", "Could not read the state file."));
		return;
	}
	if (!UStoryletSave::LoadStateFromJson(Engine, Text))
	{
		FMessageDialog::Open(EAppMsgType::Ok,
			LOCTEXT("LoadParseFail", "Not a valid storylets state file (see the Output Log)."));
	}
}

#undef LOCTEXT_NAMESPACE
