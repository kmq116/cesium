/* eslint-disable new-cap */
/* eslint-disable no-undef */
import Cartesian3 from "./Cartesian3.js";
import Cartographic from "./Cartographic.js";
import Check from "./Check.js";
import defined from "./defined.js";
import DeveloperError from "./DeveloperError.js";
import Ellipsoid from "./Ellipsoid.js";
import FeatureDetection from "./FeatureDetection.js";
import RuntimeError from "./RuntimeError.js";

// The maximum level supported within an S2 cell ID. Each level is represented by two bits in the final cell ID
var S2MaxLevel = 30;

// The number of bits in a S2 cell ID used for specifying the base face
var S2FaceBits = 3;

// The maximum value of an si- or ti-coordinate.  The range of valid (si,ti) values is [0..kMaxSiTi].
var S2MaxSiTi = 1 << (S2MaxLevel + 1);

// The number of bits in a S2 cell ID used for specifying the position along the Hilbert curve
var S2PositionBits = 2 * S2MaxLevel + 1;

// The number of bits per I and J in the lookup tables
var S2LookupBits = 4;

// Lookup table for mapping 10 bits of IJ + orientation to 10 bits of Hilbert curve position + orientation.
var S2LookupPositions = [];

// Lookup table for mapping 10 bits of IJ + orientation to 10 bits of Hilbert curve position + orientation.
var S2LookupIJ = [];

// Lookup table of two bits of IJ from two bits of curve position, based also on the current curve orientation from the swap and invert bits
var S2PosToIJ = [
  [0, 1, 3, 2], // 0: Normal order, no swap or invert
  [0, 2, 3, 1], // 1: Swap bit set, swap I and J bits
  [3, 2, 0, 1], // 2: Invert bit set, invert bits
  [3, 1, 0, 2], // 3: Swap and invert bits set
];

// Mask that specifies the swap orientation bit for the Hilbert curve
var S2SwapMask = 1;

// Mask that specifies the invert orientation bit for the Hilbert curve
var S2InvertMask = 2;

// Lookup for the orientation update mask of one of the four sub-cells within a higher level cell.
// This mask is XOR'ed with the current orientation to get the sub-cell orientation.
var S2PosToOrientationMask = [S2SwapMask, 0, 0, S2SwapMask | S2InvertMask];

/**
 * Represents a cell in the S2 geometry library.
 *
 * @alias S2Cell
 * @constructor
 *
 * @private
 *
 * @param {BigInt} [cellId] The 64-bit S2CellId.
 */
function S2Cell(cellId) {
  if (!FeatureDetection.supportsBigInt()) {
    throw new RuntimeError("S2 required BigInt support");
  }
  //>>includeStart('debug', pragmas.debug);
  if (!defined(cellId)) {
    throw new DeveloperError("cell ID is required.");
  }
  if (!S2Cell.isValidId(cellId)) {
    throw new DeveloperError("cell ID is invalid.");
  }
  //>>includeEnd('debug');

  this._cellId = cellId;
  this._level = S2Cell.getLevel(cellId);
}

/**
 * Creates a new S2Cell from a token. A token is a hexadecimal representation of the 64-bit S2CellId.
 *
 * @private
 *
 * @param {String} token The token for the S2 Cell.
 * @returns {S2Cell} Returns a new S2Cell.
 */
S2Cell.fromToken = function (token) {
  //>>includeStart('debug', pragmas.debug);
  Check.typeOf.string("token", token);
  if (!S2Cell.isValidToken(token)) {
    throw new DeveloperError("token is invalid.");
  }
  //>>includeEnd('debug');

  return new S2Cell(S2Cell.getIdFromToken(token));
};

/**
 * Validates an S2 cell ID.
 *
 * @param {BigInt} [cellId] The S2CellId.
 * @returns {Boolean} Returns true if the cell ID is valid, returns false otherwise.
 */
S2Cell.isValidId = function (cellId) {
  //>>includeStart('debug', pragmas.debug);
  Check.typeOf.bigint("cellId", cellId);
  //>>includeEnd('debug');

  if (cellId <= 0) return false;

  // Check if face bits indicate a value <= 5.
  if (cellId >> BigInt(S2PositionBits) > 5) return false;

  // Check trailing 1 bit is in one of the even bit positions allowed for the 30 levels, using a bitmask.
  var lowestSetBit = cellId & (~cellId + BigInt(1));
  if (!(lowestSetBit & BigInt("0x1555555555555555"))) {
    return false;
  }

  return true;
};

/**
 * Validates an S2 cell token.
 *
 * @param {String} [token] The hexadecimal representation of an S2CellId. 0 must be represented using "X".
 * @returns {Boolean} Returns true if the token is valid, returns false otherwise.
 */
S2Cell.isValidToken = function (token) {
  //>>includeStart('debug', pragmas.debug);
  Check.typeOf.string("token", token);
  //>>includeEnd('debug');

  var regex = new RegExp("^[0-9a-fA-F]{1,16}$");
  if (!regex.test(token)) {
    return false;
  }

  return S2Cell.isValidId(S2Cell.getIdFromToken(token));
};

/**
 * Converts an S2 cell token to a 64-bit S2 cell ID.
 *
 * @param {String} [token] The hexadecimal representation of an S2CellId. 0 must be represented using "X". Expected to be a valid S2 token.
 * @returns {BigInt} Returns the S2 cell ID.
 */
S2Cell.getIdFromToken = function (token) {
  //>>includeStart('debug', pragmas.debug);
  Check.typeOf.string("token", token);
  //>>includeEnd('debug');

  // 'X' is a special case of the S2Token, representing the 0 cell.
  if (token === "X") {
    return BigInt(0);
  }

  return BigInt("0x" + token + "0".repeat(16 - token.length));
};

/**
 * Converts a 64-bit S2 cell ID to an S2 cell token.
 *
 * @param {BigInt} [cellId] The S2 cell ID.
 * @returns {BigInt} Returns hexadecimal representation of an S2CellId.
 */
S2Cell.getTokenFromId = function (cellId) {
  //>>includeStart('debug', pragmas.debug);
  Check.typeOf.bigint("cellId", cellId);
  //>>includeEnd('debug');

  // 'X' is a special case of the S2Token, representing the 0 cell.
  if (cellId === BigInt(0)) {
    return "X";
  }

  return cellId.toString(16).replace(/0*$/, "");
};

/**
 * Gets the level of the cell from the cell ID.
 *
 * @param {BigInt} [cellId] The S2 cell ID.
 * @returns {number} Returns the level of the cell.
 */
S2Cell.getLevel = function (cellId) {
  //>>includeStart('debug', pragmas.debug);
  Check.typeOf.bigint("cellId", cellId);
  if (!S2Cell.isValidId(cellId)) {
    throw new DeveloperError();
  }
  //>>includeEnd('debug');

  var lsbPosition = 0;
  while (cellId !== BigInt(0)) {
    if (cellId & BigInt(1)) {
      break;
    }
    lsbPosition++;
    cellId = cellId >> BigInt(1);
  }

  return S2MaxLevel - (lsbPosition >> 1);
};

/**
 * Gets the child cell of the cell at the given index.
 *
 * @param {Number} index An integer index of the child.
 * @returns {S2Cell} The child of the S2Cell.
 */
S2Cell.prototype.getChild = function (index) {
  //>>includeStart('debug', pragmas.debug);
  Check.typeOf.number("index", index);
  if (index < 0 || index > 3) {
    throw new DeveloperError("child index must be in the range [0-3].");
  }
  if (this._level === 30) {
    throw new DeveloperError("cannot get child of leaf cell.");
  }
  //>>includeEnd('debug');

  var newLsb = lsb(this._cellId) >> BigInt(2);
  var childCellId = this._cellId + BigInt(2 * index + 1 - 4) * newLsb;
  return new S2Cell(childCellId);
};

/**
 * Gets the parent cell of an S2Cell.
 *
 * @returns {S2Cell} Returns the parent of the S2Cell.
 */
S2Cell.prototype.getParent = function () {
  //>>includeStart('debug', pragmas.debug);
  if (this._level === 0) {
    throw new DeveloperError("cannot get parent of root cell.");
  }
  //>>includeEnd('debug');
  var newLsb = lsb(this._cellId) << BigInt(2);
  return new S2Cell((this._cellId & (~newLsb + BigInt(1))) | newLsb);
};

/**
 * Get center of the S2 cell.
 *
 * @returns {Cartesian} The position of center of the S2 cell.
 */
S2Cell.prototype.getCenter = function () {
  var center = getS2Center(this._cellId);
  // Normalize XYZ.
  Cartesian3.normalize(center, center);
  var cartographic = new Cartographic.fromCartesian(
    center,
    Ellipsoid.UNIT_SPHERE
  );
  // Interpreting cartographic coordinates on UNIT_SPHERE as coords on WGS84.
  return Cartographic.toCartesian(
    cartographic,
    Ellipsoid.WGS84,
    new Cartesian3()
  );
};

// /**
//  * Get vertex of the S2 cell.
//  *
//  * @param {Number} index An integer index of the vertex.
//  * @returns {Cartesian} The position of the vertex of the S2 cell.
//  */
//  S2Cell.prototype.getVertex = function (index) {
//   var center = getS2Vertex(this._cellId, index);
//   // Normalize XYZ.
//   Cartesian3.normalize(center, center);
//   var cartographic = new Cartographic.fromCartesian(
//     center,
//     Ellipsoid.UNIT_SPHERE
//   );
//   //  Interpreting cartographic coordinates on UNIT_SPHERE as coords on WGS84.
//   return Cartographic.toCartesian(
//     cartographic,
//     Ellipsoid.WGS84,
//     new Cartesian3()
//   );
// };

// S2 Coordinate Conversions

function generateLookupCell(
  level,
  i,
  j,
  originalOrientation,
  position,
  orientation
) {
  if (level === S2LookupBits) {
    var ij = (i << S2LookupBits) + j;
    S2LookupPositions[(ij << 2) + originalOrientation] =
      (position << 2) + orientation;
    S2LookupIJ[(position << 2) + originalOrientation] = (ij << 2) + orientation;
  } else {
    level++;
    i <<= 1;
    j <<= 1;
    position <<= 2;
    var r = S2PosToOrientationMask[orientation];
    generateLookupCell(
      level,
      i + (r[0] >> 1),
      j + (r[0] & 1),
      originalOrientation,
      position,
      orientation ^ S2PosToOrientationMask[0]
    );
    generateLookupCell(
      level,
      i + (r[1] >> 1),
      j + (r[1] & 1),
      originalOrientation,
      position + 1,
      orientation ^ S2PosToOrientationMask[1]
    );
    generateLookupCell(
      level,
      i + (r[2] >> 1),
      j + (r[2] & 1),
      originalOrientation,
      position + 2,
      orientation ^ S2PosToOrientationMask[2]
    );
    generateLookupCell(
      level,
      i + (r[3] >> 1),
      j + (r[3] & 1),
      originalOrientation,
      position + 3,
      orientation ^ S2PosToOrientationMask[3]
    );
  }
}

function generateLookupTable() {
  generateLookupCell(0, 0, 0, 0, 0, 0);
  generateLookupCell(0, 0, 0, S2SwapMask, 0, S2SwapMask);
  generateLookupCell(0, 0, 0, S2InvertMask, 0, S2InvertMask);
  generateLookupCell(
    0,
    0,
    0,
    S2SwapMask | S2InvertMask,
    0,
    S2SwapMask | S2InvertMask
  );
}

/**
 * Return the {face, si, ti} coordinates of the center of the cell.
 *
 * @private
 */
function getFaceSiTi(cellId) {
  var faceIJOrientation = getFaceIJOrientation(cellId);
  var i = faceIJOrientation[0];
  var j = faceIJOrientation[1];
  var face = faceIJOrientation[2];
  var delta =
    S2Cell.getLevel(cellId) === 30
      ? 1
      : i ^ (Number(cellId >> BigInt(2)) & 1)
      ? 2
      : 0;
  return [face, 2 * i + delta, 2 * j + delta];
}

function FaceSiTitoXYZ(face, si, ti) {
  var u = STtoUV(SiTitoST(si));
  var v = STtoUV(SiTitoST(ti));
  return FaceUVtoXYZ(face, u, v);
}

function FaceUVtoXYZ(face, u, v) {
  switch (face) {
    case 0:
      return new Cartesian3(1, u, v);
    case 1:
      return new Cartesian3(-u, 1, v);
    case 2:
      return new Cartesian3(-u, -v, 1);
    case 3:
      return new Cartesian3(-1, -v, -u);
    case 4:
      return new Cartesian3(v, -1, -u);
    default:
      return new Cartesian3(v, u, -1);
  }
}

function STtoUV(s) {
  if (s >= 0.5) return (1 / 3) * (4 * s * s - 1);
  return (1 / 3) * (1 - 4 * (1 - s) * (1 - s));
}

function SiTitoST(si) {
  return (1.0 / S2MaxSiTi) * si;
}

function getS2Center(cellId) {
  var faceSiTi = getFaceSiTi(cellId);
  return FaceSiTitoXYZ(faceSiTi[0], faceSiTi[1], faceSiTi[2]);
}

function getFaceIJOrientation(cellId, orientation) {
  if (S2LookupPositions.length === 0) {
    generateLookupTable();
  }

  var i = 0;
  var j = 0;
  var face = Number(cellId >> BigInt(S2PositionBits));
  var bits = face & S2SwapMask;

  for (var k = 7; k >= 0; k--) {
    var nBits = k === 7 ? S2MaxLevel - 7 * S2LookupBits : S2LookupBits;
    bits += Number(
      (cellId >> BigInt(k * 2 * S2LookupBits + 1)) &
        BigInt((1 << (2 * nBits - 1)) << 2)
    );
    bits += S2LookupIJ[bits];
    i += (bits >> (S2LookupBits + 2)) << (k * S2LookupBits);
    j += ((bits >> 2) & ((1 << S2LookupBits) - 1)) << (k * S2LookupBits);
    bits &= S2SwapMask | S2InvertMask;
  }

  if (orientation) {
    if (lsb(cellId) & BigInt("0x1111111111111110")) {
      bits ^= S2SwapMask;
    }
    orientation = bits;
  }

  return [i, j, face, orientation];
}

// Helper functions

/**
 * @private
 */
function lsb(cellId) {
  return cellId & (~cellId + BigInt(1));
}

export default S2Cell;