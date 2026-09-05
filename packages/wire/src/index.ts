// ---------------------------------------------------------------------------
// @storylet-studio/wire - the Storylet Server's wire contract.
//
// ONE definition of every request body, response body and SSE event that
// crosses the wire between the server and anything that talks to it: the
// reference kiosk, the crew view, the console, Storyletter's Server menu, an
// integrator's show-control system. Both ends import these types, so a shape
// change on one side is a compile error on the other instead of a silent
// runtime mismatch.
//
// TWO LEVELS (4a). A VENUE is the physical place, one per server: its
// locations, each a position on the plan with a printed code, and its
// stations, each hardware with a key. An INSTALLATION is one story running
// there, and a venue hosts several, each binding its own hands to the venue's
// locations. A placard is a LOCATION, not a station: its QR says only where it
// is, and the scanning party's credential decides which story answers.
//
// The old system's audit found six high-severity bugs in one pass, every one
// a client-server shape mismatch that both test suites passed because each
// mocked the other. This package is the fix, and it is written FIRST (6.1).
// Its shapes are new: draws, sites and zones belonged to the old model, and
// this one speaks hands, boxes, cards and outcomes, by gameId.
//
// Types only, plus a handful of string constants. No behaviour lives here.
// ---------------------------------------------------------------------------

export {
  CLOCK_PATHS, CLOCK_PHASE, CLOCK_SHOW, CLOCK_WALL,
} from "./cues.js";
export type { Clocks, CueAction, CueEntry, CueSchedule } from "./cues.js";

export {
  HOUSE_FLOW, IDEMPOTENCY_HEADER, WIRE_CONSOLE_PATH, WIRE_PATH, WIRE_VERSION,
} from "./vocabulary.js";
export type {
  Actor, BuildId, BuildIdentity, CredentialId, CredentialKind, FlowRef, GameId, InstallationId,
  IsoTimestamp, LocationId, MessageId, Page, PageRequest, PartyId, PrincipalId, PrincipalRole,
  PropertyPath, RevisionId, RunId, StationId, StationKind, VenueId, VisitId, WireEnvelopeRules,
  ZoneId,
} from "./vocabulary.js";

export type { WireError, WireErrorCode } from "./errors.js";

export type {
  BindingView, BoardView, BridgeView, BundleView, CredentialView, DealtCardView, InstallationView,
  LocationView, MessageAudience, MessageView, OutcomeViewWire, PartyView, PresenceView,
  PrincipalView, PropertyView, RevisionView, RunView, StationView, TurnsView, VenueView, VisitView,
} from "./views.js";

export type {
  AckMessageRequest, AckMessageResponse, AttachAtLocationRequest, AttachAtLocationResponse,
  ChooseInstallationRequest, ChooseInstallationResponse,
  ClaimPartyRequest, ClaimPartyResponse, CreateStreamTicketRequest, CreateStreamTicketResponse,
  DealRequest, DealResponse, DetachStationRequest, DetachStationResponse, GetBoardRequest,
  GetBoardResponse, GetOutcomesRequest, GetOutcomesResponse, GetPropertiesRequest,
  GetPropertiesResponse, GetWorldRequest, GetWorldResponse, HandshakeRequest, HandshakeResponse,
  HelloRequest, HelloResponse, IssueCredentialRequest, IssueCredentialResponse, ListMessagesRequest,
  ListMessagesResponse, MintPartyRequest, MintPartyResponse, OpenVisitRequest, OpenVisitResponse,
  ParkVisitRequest, ParkVisitResponse, PeekRequest, PeekResponse, PlayRequest, PlayResponse,
  SendMessageRequest, SendMessageResponse, SetPresenceRequest, SetPresenceResponse,
} from "./station.js";

export type { PairRequest, PairResponse } from "./pairing.js";

export type { WireEvent, WireEventBase, WireTraceCard, WireTraceEvent, WireTraceVerdict } from "./events.js";

export type {
  AdvanceHouseRequest, AdvanceHouseResponse, AdvanceTurnsRequest, AdvanceTurnsResponse,
  BindHandRequest, BindHandResponse, BindStationRequest, BindStationResponse,
  BindStationToLocationRequest, BindStationToLocationResponse, BroadcastMessageRequest,
  BroadcastMessageResponse, CloseInstallationRequest, CloseInstallationResponse,
  ConfigureBridgeRequest, ConfigureBridgeResponse, CreateLocationRequest, CreateLocationResponse,
  DealHouseRequest, DealHouseResponse,
  DetachVisitStationRequest, DetachVisitStationResponse, EditPocketRequest, EditPocketResponse,
  EndRunRequest, EndRunResponse, EvictCardRequest, EvictCardResponse, FireCueRequest,
  FireCueResponse, ForceDealRequest, ForceDealResponse, ForcePlayRequest, ForcePlayResponse,
  ForgetPartyRequest, ForgetPartyResponse, GetContractRequest, GetContractResponse,
  GetCueListRequest, GetCueListResponse, GetJournalRequest, GetJournalResponse, GetPartyRequest,
  GetPartyResponse, GetVenueRequest, GetVenueResponse, GetVisitLensRequest, GetVisitLensResponse,
  GoLiveRequest, GoLiveResponse,
  HotSwapRequest, HotSwapResponse, JournalEntry, ListBindingsRequest, ListBindingsResponse,
  ListBridgesRequest, ListBridgesResponse,
  ListBundlesRequest, ListBundlesResponse, ListInstallationsRequest, ListInstallationsResponse,
  ListLocationsRequest, ListLocationsResponse, ListPartiesRequest, ListPartiesResponse,
  ListPresenceRequest, ListPresenceResponse, ListPrincipalsRequest, ListPrincipalsResponse,
  ListRevisionsRequest, ListRevisionsResponse, ListRunsRequest, ListRunsResponse, ListVisitsRequest,
  ListVisitsResponse, MoveCredentialRequest, MoveCredentialResponse, NewFromSeedRequest,
  NewFromSeedResponse, OpenInstallationRequest, OpenInstallationResponse, PairPrincipalRequest,
  PairPrincipalResponse, ParkVisitConsoleRequest,
  ParkVisitConsoleResponse, PauseRunRequest, PauseRunResponse,
  PlayHouseRequest, PlayHouseResponse, PreviewSwapRequest,
  PreviewSwapResponse, PrintLocationSheetRequest, PrintLocationSheetResponse, PullProjectRequest,
  PullProjectResponse, PushProjectRequest,
  PushProjectResponse, PutCueListRequest, PutCueListResponse, ReadWorldRequest, ReadWorldResponse,
  RelabelPrincipalRequest, RelabelPrincipalResponse, ResetDurableRequest, ResetDurableResponse,
  RestoreFromJournalRequest, RestoreFromJournalResponse, ResumeRunRequest, ResumeRunResponse,
  RevokeCredentialRequest, RevokeCredentialResponse, RevokePrincipalRequest,
  RevokePrincipalResponse, RollbackBundleRequest, RollbackBundleResponse, SetPropertyRequest,
  SetPropertyResponse, SnapshotRunRequest, SnapshotRunResponse, StageBundleRequest,
  StageBundleResponse, StartRunRequest, StartRunResponse, TestFireBridgeRequest,
  TestFireBridgeResponse, UnbindHandRequest, UnbindHandResponse, UpdateInstallationRequest,
  UpdateInstallationResponse, UpdateLocationRequest, UpdateLocationResponse, UploadBundleRequest,
  UploadBundleResponse, WireCommand, WriteWorldRequest, WriteWorldResponse,
} from "./console.js";

// LoadReport (4.9) is the MODEL's, and the console types below reference it
// from there: `import type { LoadReport } from "@storylet-studio/model"`. It is
// not re-exported, so there is one home for it and no second name to drift.
