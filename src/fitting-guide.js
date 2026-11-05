/* Offline fitting guide: a cutter's decision tree from what is seen at a baste
   fitting to the cause and the corrections, as deltas to the current draft.
   Every value is a starting point the cutter edits before recording the fitting.
   Parameter keys are those in Cutter.ADJ_PARAMS. */
(function (root) {
  "use strict";

  const R = (cause, deltas, note) => ({ cause, deltas, note: note || "" });

  const GUIDE = [
    { id: "seat", label: "Seat and back", symptoms: [
      { id: "folds_under_seat", label: "Folds under the seat",
        ask: { q: "Do the folds run horizontally, or diagonally toward the fork?", options: [
          { label: "Horizontally, across the back thigh", result: R("Too much length in the back seam: the seat angle is too steep for the figure.",
            [{ param: "seatWedge", value: 8 }, { param: "seatAngleDeg", value: -1 }], "Pin out the fold at the seat line to measure the wedge; taper it to nil at the side seam.") },
          { label: "Diagonally, pointing to the fork", result: R("Back fork too short: the seat is being pulled into the fork.",
            [{ param: "backFork", value: 8 }], "Check the back fork does not drag once lengthened.") },
          { label: "Loose cloth hanging below the seat", result: R("Back fork too long or too much seat: the cloth has nowhere to go.",
            [{ param: "backFork", value: -6 }, { param: "seatEase", value: -10 }]) },
        ] } },
      { id: "seat_tight", label: "Seat feels tight, strain across the seat", result: R("Seat too small for the figure.", [{ param: "seatEase", value: 15 }], "Let out at the back seam first: the inlay is there for it.") },
      { id: "seat_baggy", label: "Seat baggy, cloth stands off the seat", result: R("Too much seat ease for the cloth and figure.", [{ param: "seatEase", value: -15 }]) },
      { id: "back_waist_dips", label: "Back waist pulls down when seated", result: R("Back rise too short.", [{ param: "backRaise", value: 15 }], "Have the client sit and bend; mark where the waistband should finish at CB.") },
      { id: "back_waist_folds", label: "Horizontal folds just below the back waistband", result: R("Back rise too long for the stance.", [{ param: "backRaise", value: -10 }]) },
      { id: "back_waist_gapes", label: "Back waist stands away from the body at CB", result: R("Too much waist at the back seam.", [{ param: "waistEase", value: -10 }], "Take in at the back seam, tapering into the seat.") },
    ] },
    { id: "front", label: "Front and fly", symptoms: [
      { id: "whiskers", label: "Whiskers at the front fork, pointing to the crotch", result: R("Front fork too short.", [{ param: "frontFork", value: 6 }]) },
      { id: "front_baggy", label: "Bagginess below the fly, front rise too long", result: R("Front rise too long.", [{ param: "frontRaise", value: -10 }]) },
      { id: "front_waist_dips", label: "Front waist dips at CF, pulled down by the stomach", result: R("Front rise too short over the stomach.", [{ param: "frontRaise", value: 10 }]) },
      { id: "pleats_open", label: "Pleats open when standing",
        ask: { q: "Where is the strain?", options: [
          { label: "Across the front hip", result: R("Front too narrow across the hip.", [{ param: "seatEase", value: 10 }]) },
          { label: "At the waistband", result: R("Waist too tight.", [{ param: "waistEase", value: 10 }]) },
        ] } },
      { id: "thigh_breaks", label: "Cloth breaks across the front thigh", result: R("Not enough width at the thigh.", [{ param: "thighWidth", value: 10 }], "Add on the inside leg; check the fork does not drag.") },
    ] },
    { id: "fork", label: "Fork", symptoms: [
      { id: "fork_tight", label: "Tight in the fork, cuts in when walking", result: R("Fork too short overall.", [{ param: "frontFork", value: 4 }, { param: "backFork", value: 6 }]) },
      { id: "fork_low", label: "Fork hangs low, cloth between the legs", result: R("Fork too long overall.", [{ param: "frontFork", value: -4 }, { param: "backFork", value: -6 }]) },
    ] },
    { id: "leg", label: "Leg and crease", symptoms: [
      { id: "crease_off", label: "Crease falls off the centre of the shoe",
        ask: { q: "Which way does the crease fall?", options: [
          { label: "To the outside of the shoe", result: R("Leg line set for straighter legs than the client has (toward bow legs).", [{ param: "kneeShift", value: 8 }, { param: "hemShift", value: 5 }]) },
          { label: "To the inside of the shoe", result: R("Leg line set for straighter legs than the client has (toward knock knees).", [{ param: "kneeShift", value: -8 }, { param: "hemShift", value: -5 }]) },
        ] } },
      { id: "leg_twists", label: "Leg twists, crease spirals",
        ask: { q: "Which way does the crease twist below the knee?", options: [
          { label: "Toward the front, inside leg pulls forward", result: R("Back inside leg too short against the front.", [{ param: "backInsideLegShorten", value: -3 }], "Stretch less in pressing, or check the fork-to-knee match.") },
          { label: "Toward the back", result: R("Back inside leg too long against the front.", [{ param: "backInsideLegShorten", value: 3 }], "Stretch the back inside leg a little more in pressing.") },
        ] } },
      { id: "leg_width", label: "Leg too wide or too narrow", result: R("A style choice, not a draft fault.", [], "Change the bottom measure or leg line on the Measures tab.") },
    ] },
    { id: "length", label: "Length and waist", symptoms: [
      { id: "length", label: "Length is wrong at the hem", ask: { q: "Longer or shorter?", options: [
        { label: "Too long", result: R("Outside leg too long.", [{ param: "outsideLeg", value: -10 }], "Set the amount from the pinned hem.") },
        { label: "Too short", result: R("Outside leg too short.", [{ param: "outsideLeg", value: 10 }], "Set the amount from the hem chalk mark.") },
      ] } },
      { id: "waist_fit", label: "Waist loose or tight", ask: { q: "Loose or tight?", options: [
        { label: "Loose", result: R("Too much waist ease.", [{ param: "waistEase", value: -10 }], "Measure the pinned excess and halve it per side.") },
        { label: "Tight", result: R("Too little waist ease.", [{ param: "waistEase", value: 10 }]) },
      ] } },
    ] },
  ];

  const api = { GUIDE };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.FittingGuide = api;
})(typeof window !== "undefined" ? window : globalThis);
