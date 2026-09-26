// const UserProfile = () => {
//   const [userData, setUserData] = React.useState({
//     username: pseudo ? pseudo : "Guest",
//     email: "john.doe@example.com",
//     age: "30",
//     joinedDate: date_joined ? date_joined : "Today?"
//   });

//   const [editing, setEditing] = React.useState({
//     username: false,
//     email: false,
//     age: false,
//     joinedDate: false
//   });

//   const [tempValue, setTempValue] = React.useState("");

//   const startEdit = (field, value) => {
//     setEditing({ ...editing, [field]: true });
//     setTempValue(value);
//   };

//   const cancelEdit = (field) => {
//     setEditing({ ...editing, [field]: false });
//     setTempValue("");
//   };

//   const saveEdit = (field) => {
//     setUserData({ ...userData, [field]: tempValue });
//     setEditing({ ...editing, [field]: false });
//     setTempValue("");
//   };

//   const EditableField = ({ label, field, value }) => (
//     React.createElement("div", {
//       style: {
//         display: "flex",
//         alignItems: "center",
//         justifyContent: "space-between",
//         padding: "1rem 0",
//         borderBottom: "1px solid #eee"
//       }
//     },
//       React.createElement("label", {
//         style: { fontWeight: "bold", color: "#4a5568" }
//       }, `${label}:`),
//       React.createElement("div", { style: { display: "flex", alignItems: "center", gap: "0.5rem" } },
//         editing[field]
//           ? React.createElement("div", { style: { display: "flex", alignItems: "center", gap: "0.5rem" } },
//               React.createElement("input", {
//                 type: "text",
//                 value: tempValue,
//                 onChange: (e) => setTempValue(e.target.value),
//                 style: {
//                   padding: "0.25rem 0.5rem",
//                   border: "1px solid #e2e8f0",
//                   borderRadius: "0.25rem"
//                 }
//               }),
//               React.createElement("button", {
//                 onClick: () => saveEdit(field),
//                 style: {
//                   padding: "0.25rem",
//                   color: "#48bb78",
//                   cursor: "pointer",
//                   background: "none",
//                   border: "none"
//                 }
//               }, "✓"),
//               React.createElement("button", {
//                 onClick: () => cancelEdit(field),
//                 style: {
//                   padding: "0.25rem",
//                   color: "#f56565",
//                   cursor: "pointer",
//                   background: "none",
//                   border: "none"
//                 }
//               }, "✕")
//           )
//           : React.createElement(React.Fragment, null,
//               React.createElement("span", { style: { fontSize: "1.125rem" } }, value),
//               React.createElement("button", {
//                 onClick: () => startEdit(field, value),
//                 style: {
//                   padding: "0.25rem",
//                   color: "#718096",
//                   cursor: "pointer",
//                   background: "none",
//                   border: "none"
//                 }
//               }, "✎")
//           )
//       )
//     )
//   );

//   return React.createElement("div", {
//     style: {
//       margin: "-1.5rem auto",
//       padding: "1.5rem",
//     }
//   },
//     React.createElement("h2", {
//       style: {
//         width: "100%",
//         fontSize: "1.5rem",
//         fontWeight: "bold",
//         color: "#1a202c",
//         marginBottom: "1.5rem",
//         paddingBottom: "0.75rem",
//         borderBottom: "2px solid #ddd",
//         textAlign: "center"
//       }
//     }, "User Profile"),
//     React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: "0.5rem" } },
//       React.createElement(EditableField, { label: "Name", field: "username", value: userData.username }),
//       React.createElement(EditableField, { label: "Email", field: "email", value: userData.email }),
//       React.createElement(EditableField, { label: "Age", field: "age", value: userData.age }),
//       React.createElement(EditableField, { label: "Joined Date", field: "joinedDate", value: userData.joinedDate })
//     )
//   );
// };

// // Wait for DOM to be fully loaded
// document.addEventListener("DOMContentLoaded", () => {
//   const container = document.getElementById("user-profile-root");
//   if (container && !container._reactRootContainer) {
//     const root = ReactDOM.createRoot(container);
//     root.render(React.createElement(UserProfile));
//   }
// });
